export type HarnessStatus = "NONE" | "PENDING_CONFIRMATION" | "ACTIVE" | "FAILED";
export type HarnessSource = "NONE" | "AUTO_INFERRED" | "USER_PROVIDED";
export type FingerprintState = "IN_PROGRESS" | "PR_CREATED" | "RESOLVED" | "FAILED";

export interface RepoSettings {
  repositoryFullName: string;
  active: boolean;
  slackWebhookUrl?: string | null;
  customModel?: string | null;
  customBaseUrl?: string | null;
  harnessCmd?: string | null;
  inferredHarnessCmd?: string | null;
  harnessStatus: HarnessStatus;
  harnessSource: HarnessSource;
  ralphMaxRetries: number;
  logIngestActive?: boolean;
  logReceiverToken?: string | null;
  ec2Ip?: string | null;
  logPath?: string | null;
}

export interface RepoSettingsDto {
  fullName: string;
  active: boolean;
  slackWebhookUrl?: string;
  customModel?: string;
  customBaseUrl?: string;
  harnessCmd?: string;
  inferredHarnessCmd?: string;
  harnessStatus: HarnessStatus;
  harnessSource: HarnessSource;
  ralphMaxRetries: number;
  hasAppInstalled?: boolean;
  inferenceMessage?: string | null;
  logIngestActive?: boolean;
  ec2Ip?: string | null;
  logPath?: string | null;
}

export interface SystemSettings {
  id?: string;
  githubAppId?: string | null;
  githubPrivateKeyContent?: string | null;
  githubWebhookSecret?: string | null;
  githubClientId?: string | null;
  githubClientSecret?: string | null;
  globalAiBaseUrl?: string | null;
  globalAiApiKey?: string | null;
  globalAiModel?: string | null;
  pikilandServerUrl?: string | null;
}

export interface SystemSettingsDto {
  githubAppId?: string;
  githubPrivateKeyContent?: string;
  githubWebhookSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  globalAiBaseUrl?: string;
  globalAiApiKey?: string;
  globalAiModel?: string;
  pikilandServerUrl?: string;
}

export interface LogFingerprint {
  hash: string;
  repositoryFullName: string;
  normalizedSignature: string;
  rawLog: string;
  state: FingerprintState;
  occurrenceCount: number;
  prUrl?: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}
