import { requestUrlMock } from './mocks/obsidian';

Object.assign(globalThis, { __requestUrlMock: requestUrlMock });

Object.defineProperty(HTMLElement.prototype, 'createEl', {
  value(this: HTMLElement, tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
    const el = document.createElement(tag);
    if (options?.cls) {
      el.className = options.cls;
    }
    if (options?.text) {
      el.textContent = options.text;
    }
    if (options?.attr) {
      for (const [k, v] of Object.entries(options.attr)) {
        el.setAttribute(k, v);
      }
    }
    this.appendChild(el);
    return el;
  },
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'empty', {
  value(this: HTMLElement) {
    this.innerHTML = '';
  },
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'addClass', {
  value(this: HTMLElement, cls: string) {
    this.classList.add(cls);
  },
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'removeClass', {
  value(this: HTMLElement, cls: string) {
    this.classList.remove(cls);
  },
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'setText', {
  value(this: HTMLElement, text: string) {
    this.textContent = text;
  },
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'createDiv', {
  value(this: HTMLElement, options?: { cls?: string; text?: string }) {
    return (this as any).createEl('div', options);
  },
  configurable: true
});
