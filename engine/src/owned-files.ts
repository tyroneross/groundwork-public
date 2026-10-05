import { z } from "zod";

const PRIVATE_SEGMENTS = new Set([".git", ".ssh", ".aws", ".gnupg", ".env", "secrets", "credentials"]);
const PRIVATE_NAME = /^(?:credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519))$/i;

function isSafeOwnedFile(value: string): boolean {
  if (value.includes("\0") || value.startsWith("/") || value.startsWith("~") || value.startsWith("\\\\")) return false;
  if (value.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || /%(?![0-9A-Fa-f]{2})/.test(value)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  const segments = decoded.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return false;
  return segments.every((part) => {
    const lower = part.toLowerCase();
    return !PRIVATE_SEGMENTS.has(lower) && !(lower.startsWith(".env.") && lower !== ".env.example") && !PRIVATE_NAME.test(part);
  });
}

export const OwnedFileSchema = z.string().min(1).refine(
  isSafeOwnedFile,
  "Owned files must be traversal-free, non-private repository-relative POSIX file paths.",
);

export const OwnedFilesSchema = z.array(OwnedFileSchema).min(1).superRefine((values, ctx) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: `Duplicate owned file: ${value}` });
    seen.add(value);
  });
});

export const DeclaredNewFileSchema = z.object({
  path: OwnedFileSchema,
  because: z.string().min(1),
}).strict();
