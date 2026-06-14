/** Signed OAuth state payload (JWT body). */
export type GithubOauthState = {
  nonce: string;
};

export type GithubUserProfile = {
  id: number;
  login: string;
};

export type GithubUserEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export type GithubTreeEntry = {
  path?: string;
  mode?: string;
  type?: 'blob' | 'tree' | 'commit';
  sha?: string;
  size?: number;
};

export type GithubWebhook = {
  id: number;
  type?: string;
  active: boolean;
  events: string[];
  config?: {
    url?: string;
    content_type?: string;
    insecure_ssl?: string;
  };
};

export type GithubPushWebhookPayload = {
  ref?: string;
  after?: string;
  repository?: {
    name?: string;
    owner?: { login?: string };
    full_name?: string;
  };
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
};
