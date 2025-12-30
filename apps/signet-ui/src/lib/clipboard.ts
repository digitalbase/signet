/**
 * Copy text to clipboard with fallback for non-secure contexts.
 *
 * The modern Clipboard API requires a secure context (HTTPS or localhost).
 * This utility falls back to the legacy execCommand approach when the
 * modern API is unavailable or fails (e.g., when accessing via HTTP on
 * a Tailscale IP).
 *
 * @see https://github.com/Letdown2491/signet/issues/9
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first (requires secure context)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy method
    }
  }

  // Legacy fallback using execCommand (deprecated but widely supported)
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Prevent scrolling to bottom of page
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '2em';
    textarea.style.height = '2em';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
