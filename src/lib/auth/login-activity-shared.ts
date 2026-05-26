export type LoginDeviceType =
  | "desktop"
  | "mobile"
  | "tablet"
  | "bot"
  | "unknown";

type AccessTokenClaims = {
  exp?: number;
  iat?: number;
  session_id?: string;
  aal?: string;
  amr?: Array<{ method?: string }>;
};

export type ParsedUserAgent = {
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceType: LoginDeviceType;
  deviceName?: string;
};

function normalizeVersion(value: string | undefined) {
  return value?.replace(/_/g, ".");
}

function matchNamedVersion(
  userAgent: string,
  patterns: Array<{ name: string; regex: RegExp }>,
) {
  for (const pattern of patterns) {
    const match = userAgent.match(pattern.regex);

    if (match) {
      return {
        name: pattern.name,
        version: normalizeVersion(match[1]),
      };
    }
  }

  return null;
}

function parseOperatingSystem(userAgent: string) {
  const patterns = [
    { name: "iOS", regex: /(?:iphone os|cpu (?:iphone )?os) ([\d_]+)/i },
    { name: "Android", regex: /android ([\d.]+)/i },
    { name: "Windows", regex: /windows nt ([\d.]+)/i },
    { name: "macOS", regex: /mac os x ([\d_]+)/i },
    { name: "ChromeOS", regex: /cros [^ ]+ ([\d.]+)/i },
  ];
  const match = matchNamedVersion(userAgent, patterns);

  if (match) {
    return match;
  }

  if (/linux/i.test(userAgent)) {
    return { name: "Linux", version: undefined };
  }

  return null;
}

function parseBrowser(userAgent: string) {
  const patterns = [
    { name: "Edge", regex: /edg(?:e|ios|a)?\/([\d.]+)/i },
    { name: "Opera", regex: /opr\/([\d.]+)/i },
    { name: "Chrome", regex: /crios\/([\d.]+)/i },
    { name: "Firefox", regex: /fxios\/([\d.]+)/i },
    { name: "Chrome", regex: /chrome\/([\d.]+)/i },
    { name: "Firefox", regex: /firefox\/([\d.]+)/i },
    { name: "Safari", regex: /version\/([\d.]+).*safari/i },
  ];

  return matchNamedVersion(userAgent, patterns);
}

function parseDeviceType(userAgent: string): LoginDeviceType {
  if (!userAgent) {
    return "unknown";
  }

  if (/(bot|spider|crawler|crawl|slurp)/i.test(userAgent)) {
    return "bot";
  }

  if (/(ipad|tablet|kindle|silk|playbook)/i.test(userAgent)) {
    return "tablet";
  }

  if (/(iphone|ipod|windows phone|android.*mobile|mobile)/i.test(userAgent)) {
    return "mobile";
  }

  if (/android/i.test(userAgent)) {
    return "tablet";
  }

  if (/(macintosh|windows|linux|cros)/i.test(userAgent)) {
    return "desktop";
  }

  return "unknown";
}

function parseDeviceName(userAgent: string, deviceType: LoginDeviceType) {
  if (!userAgent) {
    return undefined;
  }

  if (/iphone/i.test(userAgent)) {
    return "iPhone";
  }

  if (/ipad/i.test(userAgent)) {
    return "iPad";
  }

  if (/android/i.test(userAgent)) {
    return deviceType === "mobile" ? "Android Phone" : "Android Tablet";
  }

  if (/macintosh/i.test(userAgent)) {
    return "Mac";
  }

  if (/windows/i.test(userAgent)) {
    return "Windows PC";
  }

  if (/cros/i.test(userAgent)) {
    return "Chromebook";
  }

  if (/linux/i.test(userAgent)) {
    return "Linux PC";
  }

  return undefined;
}

export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const normalizedUserAgent = userAgent?.trim() ?? "";
  const deviceType = parseDeviceType(normalizedUserAgent);
  const operatingSystem = parseOperatingSystem(normalizedUserAgent);
  const browser = parseBrowser(normalizedUserAgent);

  return {
    browserName: browser?.name,
    browserVersion: browser?.version,
    osName: operatingSystem?.name,
    osVersion: operatingSystem?.version,
    deviceType,
    deviceName: parseDeviceName(normalizedUserAgent, deviceType),
  };
}

export function extractClientIpAddress(headers: Headers) {
  const headerCandidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
    headers.get("x-client-ip"),
    headers.get("forwarded"),
  ].filter(Boolean) as string[];

  for (const value of headerCandidates) {
    if (value.toLowerCase().startsWith("for=")) {
      const forwardedIp = value
        .slice(4)
        .split(/[;,]/)[0]
        ?.replace(/^"|"$/g, "")
        .replace(/^\[/, "")
        .replace(/\]$/, "");

      if (forwardedIp) {
        return forwardedIp;
      }
    }

    const first = value
      .split(",")[0]
      ?.trim()
      .replace(/^for=/i, "")
      .replace(/^"|"$/g, "")
      .replace(/^\[/, "")
      .replace(/\]$/, "");

    if (first) {
      return first;
    }
  }

  return undefined;
}

export function decodeSupabaseAccessTokenClaims(
  accessToken: string | null | undefined,
): AccessTokenClaims {
  if (!accessToken) {
    return {};
  }

  const [, payload] = accessToken.split(".");

  if (!payload) {
    return {};
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AccessTokenClaims;

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isLoginActivityRelationMissing(
  error: { message?: string | null } | null | undefined,
) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("login_activity") &&
    (message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("schema cache"))
  );
}
