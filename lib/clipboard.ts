export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}
