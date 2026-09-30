export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing UI element #${id}`);
  return e as T;
}

export function show(e: HTMLElement, visible: boolean): void {
  e.classList.toggle("hidden", !visible);
}
