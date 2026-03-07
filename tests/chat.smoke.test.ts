import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMock = {
  testConnection: vi.fn(),
  sendMessageStream: vi.fn()
};

vi.mock('../src/main', () => ({
  ContextMode: {
    OPEN_NOTES: 'open-notes',
    SEARCH: 'search',
    NONE: 'none'
  },
  default: class {}
}));

vi.mock('../src/services/LLMService', () => ({
  createLLMService: vi.fn(() => llmMock)
}));

import { ChatView } from '../src/views/ChatView';
import { WorkspaceLeaf } from 'obsidian';

function createPluginStub() {
  return {
    settings: {
      apiEndpoint: 'http://localhost:1234/v1/chat/completions',
      apiKey: '',
      maxTokens: 2048,
      temperature: 0.7,
      systemPrompt: 'Be concise',
      model: undefined,
      contextMode: 'none',
      ragMaxResults: 5,
      ragThreshold: 0.3,
      searchContextPercentage: 50,
      contextNotesVisible: false
    },
    ragService: {
      isCurrentlyIndexing: false,
      getStats: () => ({ documentCount: 0, fileCount: 0 })
    },
    saveSettings: vi.fn(async () => undefined)
  };
}

function createAppStub() {
  return {
    workspace: {
      openLinkText: vi.fn(),
      getLeavesOfType: vi.fn(() => []),
      getActiveViewOfType: vi.fn(() => null)
    },
    vault: {
      cachedRead: vi.fn(async () => ''),
      getMarkdownFiles: vi.fn(() => [])
    },
    metadataCache: {
      getFileCache: vi.fn(() => null)
    },
    setting: {
      open: vi.fn(),
      openTabById: vi.fn()
    }
  };
}

describe('Obsidian chat smoke test', () => {
  beforeEach(() => {
    llmMock.testConnection.mockReset();
    llmMock.sendMessageStream.mockReset();
  });

  it('opens chat view and renders ready state', async () => {
    llmMock.testConnection.mockResolvedValue({ success: true });

    const app = createAppStub();
    const leaf = new WorkspaceLeaf(app);
    const view = new ChatView(leaf as any, createPluginStub() as any);

    await view.onOpen();

    const content = view.containerEl.children[1].textContent ?? '';
    expect(content).toContain('Private AI chat');
    expect(content).toContain("What's on your mind?");
  });

  it('sends a prompt and streams assistant response', async () => {
    llmMock.testConnection.mockResolvedValue({ success: true });
    llmMock.sendMessageStream.mockImplementation(async (_message: string, _history: any[], callback: (chunk: string, done: boolean) => Promise<void>) => {
      await callback('Hello', false);
      await callback(' from test', false);
      await callback('', true);
    });

    const app = createAppStub();
    const leaf = new WorkspaceLeaf(app);
    const view = new ChatView(leaf as any, createPluginStub() as any);

    await view.onOpen();

    const input = view.containerEl.querySelector('textarea') as HTMLTextAreaElement;
    const sendButton = view.containerEl.querySelector('.local-llm-send-button') as HTMLButtonElement;

    input.value = 'ping';
    sendButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rendered = view.containerEl.textContent ?? '';
    expect(rendered).toContain('ping');
    expect(rendered).toContain('Hello from test');
    expect(llmMock.sendMessageStream).toHaveBeenCalledTimes(1);
  });

  it('streams think tags into collapsible thinking blocks without exposing raw tags', async () => {
    llmMock.testConnection.mockResolvedValue({ success: true });

    let releaseStepTwo: (() => void) | null = null;
    let releaseFinish: (() => void) | null = null;
    const stepTwoGate = new Promise<void>((resolve) => {
      releaseStepTwo = resolve;
    });
    const finishGate = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });

    llmMock.sendMessageStream.mockImplementation(async (_message: string, _history: any[], callback: (chunk: string, done: boolean) => Promise<void>) => {
      await callback('<think>1. Analyze request\n2. Gather context', false);
      await stepTwoGate;
      await callback('\n3. Identify constraints\n4. Draft response\n5. Final pass', false);
      await finishGate;
      await callback('</think>Final answer', false);
      await callback('', true);
    });

    const app = createAppStub();
    const leaf = new WorkspaceLeaf(app);
    const view = new ChatView(leaf as any, createPluginStub() as any);

    await view.onOpen();

    const input = view.containerEl.querySelector('textarea') as HTMLTextAreaElement;
    const sendButton = view.containerEl.querySelector('.local-llm-send-button') as HTMLButtonElement;
    input.value = 'test';
    sendButton.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const inProgressText = view.containerEl.textContent ?? '';
    expect(inProgressText).toContain('Thinking...');
    expect(inProgressText).not.toContain('<think>');
    let previewLines = Array.from(view.containerEl.querySelectorAll('.local-llm-thinking-preview-line'));
    expect(previewLines.length).toBe(2);
    let previewText = (view.containerEl.querySelector('.local-llm-thinking-preview-markdown')?.textContent ?? '').trim();
    expect(previewText).toContain('Analyze request');
    expect(previewText).toContain('Gather context');
    expect(view.containerEl.querySelectorAll('.local-llm-thinking-summary').length).toBe(1);

    releaseStepTwo?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    previewLines = Array.from(view.containerEl.querySelectorAll('.local-llm-thinking-preview-line'));
    expect(previewLines.length).toBe(5);
    previewText = (view.containerEl.querySelector('.local-llm-thinking-preview-markdown')?.textContent ?? '').trim();
    expect(previewText).toContain('Analyze request');
    expect(previewText).toContain('Gather context');
    expect(previewText).toContain('Final pass');

    releaseFinish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rendered = view.containerEl.textContent ?? '';
    expect(rendered).toContain('Final answer');
    expect(rendered).toContain('Thought process');
    expect(rendered).not.toContain('<think>');
    expect(rendered).not.toContain('</think>');
    expect(view.containerEl.querySelector('.local-llm-thinking-toggle')).toBeNull();
    expect(view.containerEl.querySelector('.local-llm-thinking-details')).toBeNull();
  });
});
