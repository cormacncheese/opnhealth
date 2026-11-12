/** Only ever redirect to a path on this site. */
export function safeNextPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/account";
}
