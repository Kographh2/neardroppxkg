export async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Select the text and use your device’s Copy action.');
  await navigator.clipboard.writeText(value);
}
