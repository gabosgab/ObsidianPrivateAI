import { vi } from 'vitest';

export const requestUrlMock = vi.fn();

export class App {}

export class Plugin {
  app: any;
  manifest: any;
  private _data: Record<string, unknown> = {};

  constructor(app?: any, manifest?: any) {
    this.app = app;
    this.manifest = manifest ?? { id: 'private-ai', version: '0.0.0' };
  }

  async loadData() {
    return this._data;
  }

  async saveData(data: Record<string, unknown>) {
    this._data = data;
  }

  registerView() {}
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement;

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement('div');
  }
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addDropdown(cb: (dropdown: any) => void) {
    cb(new DropdownComponent(document.createElement('div')));
    return this;
  }
  addSlider(cb: (slider: any) => void) {
    const sliderEl = document.createElement('input');
    sliderEl.type = 'range';
    cb({
      sliderEl,
      setLimits: () => ({ setValue: () => ({ setDynamicTooltip: () => ({ onChange: () => undefined }) }) })
    });
    return this;
  }
  addText() { return this; }
  addButton() { return this; }
  addToggle() { return this; }
}

export class WorkspaceLeaf {
  app: any;
  view: any;

  constructor(app: any, view?: any) {
    this.app = app;
    this.view = view;
  }

  async setViewState() {}
}

export class ItemView {
  app: any;
  leaf: any;
  containerEl: HTMLElement;

  constructor(leaf: any) {
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.containerEl.appendChild(document.createElement('div'));
    this.containerEl.appendChild(document.createElement('div'));
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  private onChangeHandler?: (value: string) => void;

  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement('select');
    containerEl.appendChild(this.selectEl);
    this.selectEl.addEventListener('change', () => {
      this.onChangeHandler?.(this.selectEl.value);
    });
  }

  addOption(value: string, label: string) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    this.selectEl.appendChild(opt);
    return this;
  }

  setValue(value: string) {
    this.selectEl.value = value;
    return this;
  }

  onChange(handler: (value: string) => void) {
    this.onChangeHandler = handler;
    return this;
  }
}

export class MarkdownView {
  file: any;

  constructor(file: any) {
    this.file = file;
  }
}

export class FileSystemAdapter {
  getBasePath() {
    return 'C:/vault';
  }
}

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export class TFile {}
export class Events {}
export class ProgressBarComponent {}

export const MarkdownRenderer = {
  render: (_app: any, markdown: string, el: HTMLElement) => {
    el.textContent = markdown;
    return Promise.resolve();
  }
};

export function requestUrl(...args: any[]) {
  return requestUrlMock(...args);
}

export function setIcon(el: HTMLElement, icon: string) {
  el.setAttribute('data-icon', icon);
}

export function getAllTags() {
  return [];
}
