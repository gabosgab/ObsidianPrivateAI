import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { LLMService, createLLMService, ChatMessage as LLMChatMessage, StreamCallback } from './LLMService';
import LocalLLMPlugin from './main';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	isStreaming?: boolean;
}

export class ChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private messageContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputElement: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private llmService: LLMService;
	private plugin: LocalLLMPlugin;
	private isStreaming: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: LocalLLMPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Initialize with plugin settings
		this.updateLLMServiceFromSettings();
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Local LLM Chat';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl('h4', { text: 'Local LLM Chat' });

		// Create message container
		this.messageContainer = container.createEl('div', {
			cls: 'local-llm-messages'
		});

		// Create input container
		this.inputContainer = container.createEl('div', {
			cls: 'local-llm-input-container'
		});

		// Create input element
		this.inputElement = this.inputContainer.createEl('textarea', {
			placeholder: 'Ask a question...',
			cls: 'local-llm-input'
		});

		// Create send button
		this.sendButton = this.inputContainer.createEl('button', {
			text: 'Send',
			cls: 'local-llm-send-button'
		});

		// Add event listeners
		this.inputElement.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		this.sendButton.addEventListener('click', () => {
			this.sendMessage();
		});

		// Add initial welcome message
		this.addMessage({
			id: 'welcome',
			role: 'assistant',
			content: 'Hello! I\'m your local LLM assistant. How can I help you today?\n\nYou can ask me questions and I\'ll respond with **markdown formatting** support!',
			timestamp: new Date()
		});
	}

	async onClose() {
		// Cleanup if needed
	}

	// Method to update LLM service from plugin settings
	updateLLMServiceFromSettings() {
		console.log('Updating LLM service with settings:', this.plugin.settings);
		this.llmService = createLLMService(this.plugin.settings.provider, {
			apiEndpoint: this.plugin.settings.apiEndpoint,
			modelName: this.plugin.settings.modelName,
			apiKey: this.plugin.settings.apiKey,
			maxTokens: this.plugin.settings.maxTokens,
			temperature: this.plugin.settings.temperature
		});
	}

	// Method to update LLM service configuration (for external use)
	updateLLMService(config: any) {
		this.llmService = createLLMService(config.provider || 'custom', {
			apiEndpoint: config.apiEndpoint,
			modelName: config.modelName,
			apiKey: config.apiKey,
			maxTokens: config.maxTokens,
			temperature: config.temperature
		});
	}

	private async sendMessage() {
		if (this.isStreaming) {
			console.log('Already streaming, ignoring new message');
			return;
		}

		const content = this.inputElement.value.trim();
		if (!content) return;

		// Update LLM service with current settings before sending
		this.updateLLMServiceFromSettings();

		// Add user message
		const userMessage: ChatMessage = {
			id: Date.now().toString(),
			role: 'user',
			content: content,
			timestamp: new Date()
		};

		this.addMessage(userMessage);
		this.inputElement.value = '';

		// Disable input while streaming
		this.setInputEnabled(false);
		this.isStreaming = true;

		// Create streaming assistant message
		const assistantMessage: ChatMessage = {
			id: 'streaming-' + Date.now(),
			role: 'assistant',
			content: '',
			timestamp: new Date(),
			isStreaming: true
		};

		this.addMessage(assistantMessage);

		try {
			// Convert chat history to LLM format
			const conversationHistory: LLMChatMessage[] = this.messages
				.filter(m => !m.isStreaming && m.id !== 'welcome')
				.map(m => ({
					role: m.role,
					content: m.content
				}));

			// Create streaming callback
			const streamCallback: StreamCallback = async (chunk: string, isComplete: boolean) => {
				if (isComplete) {
					// Finalize the message
					await this.finalizeStreamingMessage(assistantMessage.id);
					this.isStreaming = false;
					this.setInputEnabled(true);
				} else {
					// Update the streaming message
					await this.updateStreamingMessage(assistantMessage.id, chunk);
				}
			};

			// Call streaming LLM API
			await this.llmService.sendMessageStream(content, conversationHistory, streamCallback);
			
		} catch (error) {
			// Handle error
			this.handleStreamingError(assistantMessage.id, error);
			this.isStreaming = false;
			this.setInputEnabled(true);
		}
	}

	private setInputEnabled(enabled: boolean) {
		this.inputElement.disabled = !enabled;
		this.sendButton.disabled = !enabled;
		
		if (enabled) {
			this.inputElement.focus();
		}
	}

	private async updateStreamingMessage(messageId: string, chunk: string) {
		const message = this.messages.find(m => m.id === messageId);
		if (message) {
			message.content += chunk;
			// Update the content directly instead of re-rendering
			await this.updateStreamingContent(messageId, message.content);
		}
	}

	private async updateStreamingContent(messageId: string, content: string) {
		const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
		if (messageElement) {
			const contentEl = messageElement.querySelector('.local-llm-message-content') as HTMLElement;
			if (contentEl) {
				// Clear existing content
				contentEl.empty();
				// Render markdown for the streaming content
				await MarkdownRenderer.renderMarkdown(
					content,
					contentEl,
					'',
					this.plugin
				);
				// Add streaming cursor
				const cursor = contentEl.createEl('span', {
					cls: 'streaming-cursor',
					text: '▋'
				});
			}
		}
	}

	private async finalizeStreamingMessage(messageId: string) {
		const message = this.messages.find(m => m.id === messageId);
		if (message) {
			message.isStreaming = false;
			// Remove the existing message element and re-render with markdown
			const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
			if (messageElement) {
				messageElement.remove();
			}
			await this.renderMessage(message);
		}
	}

	private handleStreamingError(messageId: string, error: any) {
		const message = this.messages.find(m => m.id === messageId);
		if (message) {
			message.content = `Sorry, I encountered an error: ${error.message}. Please check your local LLM setup and configuration.`;
			message.isStreaming = false;
			// Remove the existing message element and re-render
			const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
			if (messageElement) {
				messageElement.remove();
			}
			this.renderMessage(message);
		}
		console.error('Error calling local LLM:', error);
	}

	private addMessage(message: ChatMessage) {
		this.messages.push(message);
		this.renderMessage(message);
	}

	private removeMessage(messageId: string) {
		const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
		if (messageElement) {
			messageElement.remove();
		}
		this.messages = this.messages.filter(m => m.id !== messageId);
	}

	private updateMessageDisplay(messageId: string) {
		const message = this.messages.find(m => m.id === messageId);
		if (message) {
			const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
			if (messageElement) {
				messageElement.remove();
			}
			this.renderMessage(message);
		}
	}

	private async renderMessage(message: ChatMessage) {
		const messageEl = this.messageContainer.createEl('div', {
			cls: `local-llm-message local-llm-message-${message.role}`,
			attr: { 'data-message-id': message.id }
		});

		const contentEl = messageEl.createEl('div', {
			cls: 'local-llm-message-content'
		});

		// Render markdown for assistant messages, plain text for user messages
		if (message.role === 'assistant' && !message.isStreaming) {
			// Use Obsidian's markdown renderer for completed assistant messages
			await MarkdownRenderer.renderMarkdown(
				message.content,
				contentEl,
				'',
				this.plugin
			);
		} else {
			// Plain text for user messages or streaming messages
			contentEl.setText(message.content);
			
			// Add streaming indicator
			if (message.isStreaming) {
				const cursor = contentEl.createEl('span', {
					cls: 'streaming-cursor',
					text: '▋'
				});
			}
		}

		const timestampEl = messageEl.createEl('div', {
			cls: 'local-llm-message-timestamp'
		});

		timestampEl.setText(message.timestamp.toLocaleTimeString());

		// Scroll to bottom
		this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
	}
} 