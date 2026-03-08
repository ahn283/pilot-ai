/**
 * Unified OAuth token manager with Keychain storage and automatic refresh.
 * Consolidates token lifecycle management for all Google services.
 */

import { getSecret, setSecret, deleteSecret } from '../config/keychain.js';
import { withRetry } from './retry.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface OAuthManagerOptions {
  /** Keychain key name for storing tokens */
  keychainKey: string;
  /** OAuth2 token endpoint URL */
  tokenUrl: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Time in ms before expiry to trigger preemptive refresh (default: 5 minutes) */
  refreshMarginMs?: number;
}

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

export class OAuthManager {
  private tokens: OAuthTokens | null = null;
  private readonly options: Required<OAuthManagerOptions>;

  constructor(options: OAuthManagerOptions) {
    this.options = {
      ...options,
      refreshMarginMs: options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS,
    };
  }

  /**
   * Load tokens from Keychain.
   */
  async loadTokens(): Promise<OAuthTokens | null> {
    const secret = await getSecret(this.options.keychainKey);
    if (!secret) return null;
    try {
      this.tokens = JSON.parse(secret) as OAuthTokens;
      return this.tokens;
    } catch {
      return null;
    }
  }

  /**
   * Save tokens to Keychain.
   */
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.tokens = tokens;
    await setSecret(this.options.keychainKey, JSON.stringify(tokens));
  }

  /**
   * Delete tokens from Keychain.
   */
  async deleteTokens(): Promise<void> {
    this.tokens = null;
    await deleteSecret(this.options.keychainKey);
  }

  /**
   * Returns a valid access token, refreshing if expired or close to expiring.
   * Uses retry with exponential backoff for refresh failures.
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      const loaded = await this.loadTokens();
      if (!loaded) throw new Error('No OAuth tokens available. Run OAuth flow first.');
      this.tokens = loaded;
    }

    // Check if token is still valid (with margin for preemptive refresh)
    if (Date.now() < this.tokens.expiresAt - this.options.refreshMarginMs) {
      return this.tokens.accessToken;
    }

    // Refresh with retry
    return withRetry(
      () => this.refreshToken(),
      { maxAttempts: 3, baseDelay: 1000, jitter: true },
    );
  }

  /**
   * Exchange an authorization code for tokens.
   */
  async exchangeCode(code: string, redirectUri: string, scopes?: string[]): Promise<OAuthTokens> {
    const res = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      error?: string;
    };
    if (data.error) throw new Error(`OAuth exchange error: ${data.error}`);

    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    await this.saveTokens(tokens);
    return tokens;
  }

  private async refreshToken(): Promise<string> {
    if (!this.tokens) throw new Error('No tokens to refresh');

    const res = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: this.tokens.refreshToken,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      error?: string;
    };
    if (data.error) throw new Error(`OAuth refresh error: ${data.error}`);

    this.tokens.accessToken = data.access_token;
    this.tokens.expiresAt = Date.now() + data.expires_in * 1000;
    await this.saveTokens(this.tokens);
    return this.tokens.accessToken;
  }
}
