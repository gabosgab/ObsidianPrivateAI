import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { LLMService, createLLMService, ChatMessage as LLMChatMessage } from './LLMService';
import LocalLLMPlugin from './main';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
}

export class ChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private messageContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputElement: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private llmService: LLMService;
	private plugin: LocalLLMPlugin;

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

		// Show loading indicator
		const loadingMessage: ChatMessage = {
			id: 'loading-' + Date.now(),
			role: 'assistant',
			content: 'Thinking...',
			timestamp: new Date()
		};

		this.addMessage(loadingMessage);

		try {
			// Convert chat history to LLM format
			const conversationHistory: LLMChatMessage[] = this.messages
				.filter(m => m.id !== loadingMessage.id && m.id !== 'welcome')
				.map(m => ({
					role: m.role,
					content: m.content
				}));

			// Call local LLM API
			const response = await this.llmService.sendMessage(content, conversationHistory);
			
			// Remove loading message and add actual response
			this.removeMessage(loadingMessage.id);
			
			const assistantMessage: ChatMessage = {
				id: Date.now().toString(),
				role: 'assistant',
				content: response,
				timestamp: new Date()
			};

			this.addMessage(assistantMessage);
		} catch (error) {
			// Remove loading message and show error
			this.removeMessage(loadingMessage.id);
			
			const errorMessage: ChatMessage = {
				id: Date.now().toString(),
				role: 'assistant',
				content: `Sorry, I encountered an error: ${error.message}. Please check your local LLM setup and configuration.`,
				timestamp: new Date()
			};

			this.addMessage(errorMessage);
			console.error('Error calling local LLM:', error);
		}
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

	private async renderMessage(message: ChatMessage) {
		const messageEl = this.messageContainer.createEl('div', {
			cls: `local-llm-message local-llm-message-${message.role}`,
			attr: { 'data-message-id': message.id }
		});

		const contentEl = messageEl.createEl('div', {
			cls: 'local-llm-message-content'
		});

		// Render markdown for assistant messages, plain text for user messages
		if (message.role === 'assistant') {
			// Use Obsidian's markdown renderer for assistant messages
			await MarkdownRenderer.renderMarkdown(
				message.content,
				contentEl,
				'',
				this.plugin
			);
		} else {
			// Plain text for user messages
			contentEl.setText(message.content);
		}

		const timestampEl = messageEl.createEl('div', {
			cls: 'local-llm-message-timestamp'
		});

		timestampEl.setText(message.timestamp.toLocaleTimeString());

		// Scroll to bottom
		this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
	}
} 