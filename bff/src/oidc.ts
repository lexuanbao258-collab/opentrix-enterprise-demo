// SPDX-FileCopyrightText: 2026 OpenTrix ESM contributors
// SPDX-License-Identifier: Apache-2.0
import * as client from "openid-client";
import type { Config } from "./config.js";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number; // epoch ms
}

export interface LoginStart {
  url: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export interface UserClaims {
  sub: string;
  name: string;
  username: string;
}

/** The only part of OpenID Connect the BFF needs. Tests replace it with a fake. */
export interface OidcPort {
  startLogin(): Promise<LoginStart>;
  finishLogin(
    callbackUrl: URL,
    expected: { codeVerifier: string; state: string; nonce: string },
  ): Promise<{ tokens: TokenSet; user: UserClaims }>;
  refresh(refreshToken: string): Promise<TokenSet>;
  logoutUrl(idToken: string | null): Promise<string>;
}

function toTokens(response: client.TokenEndpointResponse): TokenSet {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    idToken: response.id_token ?? null,
    expiresAt: Date.now() + (response.expires_in ?? 60) * 1000,
  };
}

/** Authorization Code with PKCE (S256), state and nonce against a confidential client. */
export function createOidc(config: Config): OidcPort {
  const redirectUri = `${config.publicOrigin}/bff/callback`;
  let discovered: Promise<client.Configuration> | null = null;
  const settings = () => {
    discovered ??= client
      .discovery(new URL(config.oidcIssuer), config.oidcClientId, config.oidcClientSecret, undefined, {
        execute: config.oidcIssuer.startsWith("http:") ? [client.allowInsecureRequests] : [],
      })
      .catch((failure) => {
        discovered = null;
        throw failure;
      });
    return discovered;
  };
  return {
    async startLogin() {
      const cfg = await settings();
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: redirectUri,
        scope: "openid profile",
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { url: url.href, codeVerifier, state, nonce };
    },
    async finishLogin(callbackUrl, expected) {
      const cfg = await settings();
      const response = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: expected.codeVerifier,
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        idTokenExpected: true,
      });
      const claims = response.claims();
      if (!claims?.sub) throw new Error("ID token without subject");
      const username = typeof claims.preferred_username === "string" ? claims.preferred_username : claims.sub;
      const name = typeof claims.name === "string" && claims.name ? claims.name : username;
      return { tokens: toTokens(response), user: { sub: claims.sub, name, username } };
    },
    async refresh(refreshToken) {
      const cfg = await settings();
      const next = toTokens(await client.refreshTokenGrant(cfg, refreshToken));
      return { ...next, refreshToken: next.refreshToken ?? refreshToken };
    },
    async logoutUrl(idToken) {
      const cfg = await settings();
      const url = client.buildEndSessionUrl(cfg, {
        post_logout_redirect_uri: `${config.publicOrigin}/`,
        ...(idToken ? { id_token_hint: idToken } : { client_id: config.oidcClientId }),
      });
      return url.href;
    },
  };
}
