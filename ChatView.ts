import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, DropdownComponent } from 'obsidian';
import { LLMService, createLLMService, ChatMessage as LLMChatMessage, StreamCallback } from './LLMService';
import { SearchService, SearchResult } from './SearchService';
import { LoggingUtility } from './LoggingUtility';
import LocalLLMPlugin, { ContextMode } from './main';

export const CHAT_VIEW_TYPE = 'local-llm-chat-view';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	isStreaming?: boolean;
	usedNotes?: SearchResult[];
}

interface LLMConfig {
	apiEndpoint: string;
	maxTokens: number;
	temperature: number;
	systemPrompt?: string;
}

interface ObsidianApp {
	setting?: {
		open: () => void;
		openTabById: (tabId: string) => void;
	};
}

interface DropdownComponentWithPrivateAPI extends DropdownComponent {
	__component?: {
		setValue: (value: string) => void;
	};
}

export class ChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private messageContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputElement: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private stopButton: HTMLButtonElement;
	private searchIndicator: HTMLElement;
	private ragStatusArea: HTMLElement;
	private ragStatusContent: HTMLElement;
	private llmService: LLMService;
	private searchService: SearchService;
	private isStreaming: boolean = false;
	private currentAbortController: AbortController | null = null;
	private contextMode: ContextMode = ContextMode.OPEN_NOTES;
	private plugin: LocalLLMPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: LocalLLMPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Pass RAG service to SearchService for enhanced search capabilities
		this.searchService = new SearchService(this.app, plugin.ragService);
		// Initialize with plugin settings
		this.updateLLMServiceFromSettings();
		// Initialize context mode from plugin settings
		this.contextMode = this.plugin.settings.contextMode;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Private AI';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('local-llm-full-height');

		// Header with title and settings button
		const header = container.createEl('div', { cls: 'local-llm-chat-header' });
		header.createEl('h4', { text: 'Private AI chat' });
		
		// Create button container for header buttons
		const headerButtons = header.createEl('div', { cls: 'local-llm-header-buttons' });
		
		// Create new chat button
		const newChatButton = headerButtons.createEl('button', {
			cls: 'local-llm-new-chat-button',
			text: 'New chat',
			attr: { 'aria-label': 'Start new chat', 'type': 'button' }
		});
		newChatButton.addEventListener('click', async () => {
			await this.startNewChat();
		});
		
		// Create context mode dropdown
		const contextModeContainer = headerButtons.createEl('div', {
			cls: 'local-llm-context-mode-container'
		});
		
		contextModeContainer.createEl('label', {
			cls: 'local-llm-context-mode-label',
			text: 'Context:'
		});
		
		const dropdown = new DropdownComponent(contextModeContainer)
			.addOption(ContextMode.OPEN_NOTES, 'Open Tabs')
			.addOption(ContextMode.SEARCH, 'All Notes')
			.addOption(ContextMode.NONE, 'None')
			.onChange(async (value) => {
				this.contextMode = value as ContextMode;
				// Save the context mode to plugin settings
				this.plugin.settings.contextMode = this.contextMode;
				await this.plugin.saveSettings();
				// Update RAG status display
				this.updateRAGStatus();
			});
		
		// Set initial value based on plugin settings
		dropdown.setValue(this.contextMode);
		
		// Create settings button
		const settingsButton = headerButtons.createEl('button', {
			cls: 'local-llm-settings-button',
			attr: { 'aria-label': 'Open plugin settings', 'type': 'button' },
			text: '⚙'
		});

		settingsButton.addEventListener('click', () => {
			// Open the settings panel and navigate to Private AI plugin settings
			const settingTab = (this.app as unknown as ObsidianApp).setting;
			if (settingTab) {
				settingTab.open();
				settingTab.openTabById('private-ai');
			}
		});

		// Create main chat container with flexbox layout
		const chatContainer = container.createEl('div', { cls: 'local-llm-chat-container' });

		// Create message container (scrollable area)
		this.messageContainer = chatContainer.createEl('div', {
			cls: 'local-llm-messages'
		});

		// Create input container (fixed at bottom)
		this.inputContainer = chatContainer.createEl('div', {
			cls: 'local-llm-input-container'
		});

		// Create search indicator
		this.searchIndicator = this.inputContainer.createEl('div', {
			cls: 'local-llm-search-indicator local-llm-search-indicator-hidden',
			text: '🔍 Searching vault...'
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

		// Create stop button
		this.stopButton = this.inputContainer.createEl('button', {
			text: 'Stop',
			cls: 'local-llm-stop-button'
		});

		// Create RAG status area below input container
		this.ragStatusArea = chatContainer.createEl('div', {
			cls: 'local-llm-rag-status-area local-llm-rag-status-hidden'
		});

		this.ragStatusContent = this.ragStatusArea.createEl('div', {
			cls: 'local-llm-rag-status-content'
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

		this.stopButton.addEventListener('click', () => {
			this.stopStreaming();
		});

		// Add initial welcome message
		this.addMessage({
			id: 'welcome',
			role: 'assistant',
			content: await ChatView.getWelcomeMessage(this.llmService),
			timestamp: new Date()
		});

		// Check and display initial RAG status
		this.updateRAGStatus();
	}

	async onClose() {
		// Cleanup if needed
	}

	// Method to update LLM service from plugin settings
	updateLLMServiceFromSettings() {
		const settings = this.plugin.settings;
		LoggingUtility.log('Updating LLM service with settings:', settings);
		this.llmService = createLLMService({
			apiEndpoint: settings.apiEndpoint,
			maxTokens: settings.maxTokens,
			temperature: settings.temperature,
			systemPrompt: settings.systemPrompt
		});
	}

	/**
	 * Update context mode from settings
	 */
	updateContextModeFromSettings(): void {
		this.contextMode = this.plugin.settings.contextMode;
		// Update dropdown to reflect new value
		const dropdown = this.containerEl.querySelector('.local-llm-context-mode-container select') as HTMLSelectElement;
		if (dropdown) {
			dropdown.value = this.contextMode;
		}
		// Update RAG status display
		this.updateRAGStatus();
	}

	updateLLMService(config: LLMConfig) {
		LoggingUtility.log('Updating LLM service with config:', config);
		this.llmService = createLLMService({
			apiEndpoint: config.apiEndpoint,
			maxTokens: config.maxTokens,
			temperature: config.temperature,
			systemPrompt: config.systemPrompt
		});
	}

	private async sendMessage() {
		const content = this.inputElement.value.trim();
		if (!content) return;

		// If already streaming, queue this message or handle it differently
		if (this.isStreaming) {
			LoggingUtility.log('Already streaming, but allowing new message to be sent');
			// We'll allow sending multiple messages, but we need to handle this properly
		}

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

		// Create abort controller for this request
		this.currentAbortController = new AbortController();

		// Keep input enabled but disable send button while streaming
		this.setSendButtonEnabled(false);
		this.showStopButton(true);
		this.isStreaming = true;

		// Get context based on dropdown selection
		let searchContext = '';
		let searchResults: SearchResult[] = [];
		
		let contextMode: ContextMode = this.contextMode;
		this.showSearchIndicator(true);
		try {
			if (contextMode === ContextMode.OPEN_NOTES) {
				// Use open tabs as context
				const openTabs = await this.searchService.getCurrentNoteContext();
				if (openTabs.length > 0) {
					searchResults = openTabs;
					searchContext = this.searchService.formatSearchResults(searchResults);
					LoggingUtility.log(`Using ${openTabs.length} open tabs as context`);
				} else {
					LoggingUtility.log('No open tabs found, no context will be used');
				}
			} else if (contextMode === ContextMode.SEARCH) {
				// Search entire vault using RAG (with keyword fallback)
				const maxContextTokens = Math.floor(this.plugin.settings.maxTokens * (this.plugin.settings.searchContextPercentage / 100));
				searchResults = await this.searchService.searchVault(content, {
					maxResults: this.plugin.settings.ragMaxResults,
					maxTokens: maxContextTokens,
					threshold: this.plugin.settings.ragThreshold
				});
				
				if (searchResults.length > 0) {
					searchContext = this.searchService.formatSearchResults(searchResults);
					LoggingUtility.log(`Found ${searchResults.length} relevant notes using enhanced search`);
				}
			} else if (contextMode === ContextMode.NONE) {
				// No context - just use the user's message as-is
				LoggingUtility.log('No context mode selected - using message without additional context');
			}
		} catch (searchError) {
			LoggingUtility.warn('Error getting context:', searchError);
			// Continue without search context if search fails
		} finally {
			this.showSearchIndicator(false);
		}

		// Create streaming assistant message
		const assistantMessage: ChatMessage = {
			id: 'streaming-' + Date.now(),
			role: 'assistant',
			content: '',
			timestamp: new Date(),
			isStreaming: true,
			usedNotes: searchResults.length > 0 ? searchResults : undefined
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

			// Add system message if search context is available
			if (searchContext) {
				conversationHistory.unshift({
					role: 'system',
					content: 'You are a helpful assistant with access to the user\'s Obsidian vault. When provided with context from their notes, use that information to provide more accurate and relevant responses. Reference specific notes when appropriate, but focus on answering the user\'s question clearly and concisely.'
				});
			}

			// Add search context to the user message if available
			let enhancedContent = content;
			if (searchContext) {
				enhancedContent = `Context from your Obsidian vault:\n${searchContext}\n\nUser question: ${content}`;
			}

			// Create streaming callback
			const streamCallback: StreamCallback = async (chunk: string, isComplete: boolean) => {
				if (isComplete) {
					// Finalize the message
					await this.finalizeStreamingMessage(assistantMessage.id);
					this.isStreaming = false;
					this.setSendButtonEnabled(true);
					this.showStopButton(false);
					this.currentAbortController = null;
				} else {
					// Update the streaming message
					await this.updateStreamingMessage(assistantMessage.id, chunk);
				}
			};

			// Call streaming LLM API with abort signal
			await this.llmService.sendMessageStream(enhancedContent, conversationHistory, streamCallback, this.currentAbortController.signal);
			
		} catch (error) {
			// Handle error
			if (error.name === 'AbortError') {
				// User cancelled - don't change the message content
				this.isStreaming = false;
				this.setSendButtonEnabled(true);
				this.showStopButton(false);
				this.currentAbortController = null;
				
				// Finalize the current streaming message as-is
				const streamingMessage = this.messages.find(m => m.isStreaming);
				if (streamingMessage) {
					streamingMessage.isStreaming = false;
					this.finalizeStreamingMessage(streamingMessage.id);
				}
			} else {
				// Handle actual errors
				this.handleStreamingError(assistantMessage.id, error);
				this.isStreaming = false;
				this.setSendButtonEnabled(true);
				this.showStopButton(false);
				this.currentAbortController = null;
			}
		}
	}

	private setInputEnabled(enabled: boolean) {
		this.inputElement.disabled = !enabled;
		this.sendButton.disabled = !enabled;
		
		if (enabled) {
			this.inputElement.focus();
		}
	}

	private setSendButtonEnabled(enabled: boolean) {
		this.sendButton.disabled = !enabled;
		
		if (enabled) {
			this.inputElement.focus();
		}
	}

	private showStopButton(show: boolean) {
		if (show) {
			this.stopButton.removeClass('local-llm-stop-button-hidden');
			this.stopButton.addClass('local-llm-stop-button-visible');
			this.sendButton.removeClass('local-llm-send-button-visible');
			this.sendButton.addClass('local-llm-send-button-hidden');
		} else {
			this.stopButton.removeClass('local-llm-stop-button-visible');
			this.stopButton.addClass('local-llm-stop-button-hidden');
			this.sendButton.removeClass('local-llm-send-button-hidden');
			this.sendButton.addClass('local-llm-send-button-visible');
		}
	}

	private showSearchIndicator(show: boolean) {
		if (show) {
			this.searchIndicator.removeClass('local-llm-search-indicator-hidden');
			this.searchIndicator.addClass('local-llm-search-indicator-visible');
		} else {
			this.searchIndicator.removeClass('local-llm-search-indicator-visible');
			this.searchIndicator.addClass('local-llm-search-indicator-hidden');
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
				MarkdownRenderer.render(
					this.app,
					content,
					contentEl,
					'',
					this
				);
				// Add streaming cursor
				const cursor = contentEl.createEl('span', {
					cls: 'streaming-cursor',
					text: '▋'
				});
				
				// Ensure text is selectable
				contentEl.addClass('local-llm-selectable-content');
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

	private handleStreamingError(messageId: string, error: Error) {
		const message = this.messages.find(m => m.id === messageId);
		if (message) {
			message.content = error.message;
			message.isStreaming = false;
			// Remove the existing message element and re-render
			const messageElement = this.messageContainer.querySelector(`[data-message-id="${messageId}"]`);
			if (messageElement) {
				messageElement.remove();
			}
			this.renderMessage(message);
		}
		LoggingUtility.error('Error calling local LLM:', error);
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
			MarkdownRenderer.render(
				this.app,
				message.content,
				contentEl,
				'',
				this
			);
			
			// Add copy button for assistant messages
			const copyButton = messageEl.createEl('button', {
				cls: 'local-llm-copy-button',
				attr: { 'aria-label': 'Copy message content', 'type': 'button' },
				text: '🗐'
			});
			
			copyButton.addEventListener('click', async () => {
				await navigator.clipboard.writeText(message.content);
				
				// Show success feedback
				copyButton.textContent = '✅';
				copyButton.classList.add('copied');
				
				setTimeout(() => {
					copyButton.textContent = '🗐';
					copyButton.classList.remove('copied');
				}, 1000);
			});
			
			// Add refresh button for installation messages (welcome messages with installation instructions)
			if (message.id === 'welcome' && message.content.includes('Welcome to Private AI!')) {
				const refreshButton = messageEl.createEl('button', {
					cls: 'local-llm-refresh-button',
					text: '🔄 Test connection',
					attr: { 'aria-label': 'Test connection to LLM server', 'type': 'button' }
				});
				
				refreshButton.addEventListener('click', async () => {
					// Show loading state
					refreshButton.textContent = '🔄 Testing...';
					refreshButton.disabled = true;
					
					try {
						// Update LLM service with current settings
						this.updateLLMServiceFromSettings();
						
						// Test connection
						const testResult = await this.llmService.testConnection();
						
						if (testResult.success) {
							// Connection successful - update the welcome message
							const welcomeMessage = this.messages.find(m => m.id === 'welcome');
							if (welcomeMessage) {
								welcomeMessage.content = 'What\'s on your mind?';
								// Re-render the message
								this.messageContainer.empty();
								for (const msg of this.messages) {
									await this.renderMessage(msg);
								}
							}
							new Notice('✅ Connection successful! You can now start chatting.', 3000);
						} else {
							// Connection failed
							new Notice('❌ Connection failed. Please check your server settings.', 3000);
							refreshButton.textContent = '🔄 Test connection';
							refreshButton.disabled = false;
						}
					} catch (error) {
						LoggingUtility.error('Error testing connection:', error);
						new Notice('❌ Connection failed. Please check your server settings.', 3000);
						refreshButton.textContent = '🔄 Test connection';
						refreshButton.disabled = false;
					}
				});
			}
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

		// Show used notes information for assistant messages
		if (message.role === 'assistant' && message.usedNotes && message.usedNotes.length > 0) {
			const notesInfoEl = messageEl.createEl('div', {
				cls: 'local-llm-used-notes'
			});
			
			const notesHeader = notesInfoEl.createEl('div', {
				cls: 'local-llm-used-notes-header',
				text: `📚 Used ${message.usedNotes.length} note${message.usedNotes.length > 1 ? 's' : ''} as context:`
			});
			
			const notesList = notesInfoEl.createEl('div', {
				cls: 'local-llm-used-notes-list'
			});
			
			message.usedNotes.forEach(note => {
				const noteEl = notesList.createEl('div', {
					cls: 'local-llm-used-note-item'
				});
				
				const noteTitle = noteEl.createEl('span', {
					cls: 'local-llm-used-note-title',
					text: note.title
				});
				
				const notePath = noteEl.createEl('span', {
					cls: 'local-llm-used-note-path',
					text: ` (${note.path})`
				});
				
				const noteRelevance = noteEl.createEl('span', {
					cls: 'local-llm-used-note-relevance',
					text: ` - ${(note.relevance * 100).toFixed(1)}% relevant`
				});
				
				// Make the note clickable to open it
				noteEl.addClass('local-llm-note-clickable');
				noteEl.addEventListener('click', () => {
					this.app.workspace.openLinkText(note.path, '', true);
				});
			});
		}

		const timestampEl = messageEl.createEl('div', {
			cls: 'local-llm-message-timestamp'
		});

		timestampEl.setText(message.timestamp.toLocaleTimeString());

		// Scroll to bottom
		this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
	}

	private stopStreaming() {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
		}
		this.isStreaming = false;
		this.setSendButtonEnabled(true);
		this.showStopButton(false);
		this.currentAbortController = null;
		
		// Finalize the current streaming message as-is
		const streamingMessage = this.messages.find(m => m.isStreaming);
		if (streamingMessage) {
			streamingMessage.isStreaming = false;
			// Re-render the message to remove the streaming cursor and apply markdown
			this.finalizeStreamingMessage(streamingMessage.id);
		}
	}

	private async startNewChat() {
		// Stop any ongoing streaming
		if (this.isStreaming) {
			this.stopStreaming();
		}

		// Clear all messages
		this.messages = [];
		this.messageContainer.empty();

		// Add new welcome message
		this.addMessage({
			id: 'welcome',
			role: 'assistant',
			content: await ChatView.getWelcomeMessage(this.llmService),
			timestamp: new Date()
		});

		// Clear input field
		this.inputElement.value = '';
		this.inputElement.focus();
	}

	private copyEntireConversation() {
		// Filter out welcome message and format conversation
		const conversationMessages = this.messages
			.filter(m => m.id !== 'welcome')
			.map(m => {
				const timestamp = m.timestamp.toLocaleString();
				const role = m.role === 'user' ? 'You' : 'Assistant';
				return `[${timestamp}] ${role}:\n${m.content}\n`;
			});
		
		const conversationText = conversationMessages.join('\n---\n\n');
		
		// Copy to clipboard
		navigator.clipboard.writeText(conversationText).then(() => { 
			new Notice('✅ Conversation copied to clipboard!', 2000);
		});
	}

	private static async getWelcomeMessage(llmService: LLMService): Promise<string> {
		// Test the connection
		const testResult = await llmService.testConnection();
		
		if (testResult.success) {
			return `What's on your mind?`;
		} else {
			return `## 🚀 Welcome to Private AI!

It looks like your local LLM server isn't running yet. Here's how to get started:

### Getting Started

1. **Download and Install LM Studio** from [lmstudio.ai](https://lmstudio.ai)
3. **Download a model** 
   * On Apple Macbooks, we recommend:
	   * \`Gemma 3 12B\` (recommended)
	   * \`Gemma 3 8B\`
   * On Windows, we recommend: 
       * \`Gemma 3\`
	   * Select the largest parameter size that LM Studio says can fit on your GPU
4. **Load the model** in LM Studio
   * Once the model is downloaded, select the model in the top center toolbar to load it
5. **Start the local server**:
- Click the "Developer" tab on the left
- Click Settings:
   - Make sure "CORS" is enabled
   - Ensure the default port number 1234 is used
- In the Status box in the top left
   - Click the radio button to start the server

Once your server is running, click the test connection button below.`;
		}
	}

	/**
	 * Update the RAG status area based on current state
	 */
	private updateRAGStatus(): void {
		// Check if currently indexing
		if (this.plugin.ragService && this.plugin.ragService.isCurrentlyIndexing) {
			// Will be updated by progress callbacks, don't show stats
			return;
		}

		// Show database stats if context mode is "All Notes"
		if (this.contextMode === ContextMode.SEARCH) {
			const stats = this.plugin.ragService.getStats();
			this.showRAGStats(stats.documentCount, stats.fileCount);
		} else {
			this.hideRAGStatus();
		}
	}

	/**
	 * Show RAG database statistics
	 */
	private showRAGStats(documentCount: number, fileCount: number): void {
		this.ragStatusContent.innerHTML = `
			<div class="local-llm-rag-stats">
				<span class="local-llm-rag-stats-icon">📚</span>
				<span class="local-llm-rag-stats-text">RAG Database: ${documentCount.toLocaleString()} paragraphs from ${fileCount.toLocaleString()} files available for context</span>
			</div>
		`;
		this.ragStatusArea.removeClass('local-llm-rag-status-hidden');
		this.ragStatusArea.addClass('local-llm-rag-status-visible');
	}

	/**
	 * Show RAG indexing progress
	 */
	showRAGProgress(current: number, total: number, message: string): void {
		const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
		
		this.ragStatusContent.innerHTML = `
			<div class="local-llm-rag-progress">
				<div class="local-llm-rag-progress-header">
					<span class="local-llm-rag-progress-icon">⚡</span>
					<span class="local-llm-rag-progress-text">Building RAG Database</span>
				</div>
				<div class="local-llm-rag-progress-details">
					<div class="local-llm-rag-progress-message">${message} (${current}/${total})</div>
					<div class="local-llm-rag-progress-bar-container">
						<div class="local-llm-rag-progress-bar" style="width: ${percentage}%"></div>
					</div>
					<div class="local-llm-rag-progress-percentage">${percentage}%</div>
				</div>
			</div>
		`;
		this.ragStatusArea.removeClass('local-llm-rag-status-hidden');
		this.ragStatusArea.addClass('local-llm-rag-status-visible');
	}

	/**
	 * Hide RAG status area
	 */
	private hideRAGStatus(): void {
		this.ragStatusArea.removeClass('local-llm-rag-status-visible');
		this.ragStatusArea.addClass('local-llm-rag-status-hidden');
	}

	/**
	 * Called when RAG indexing completes
	 */
	onRAGIndexingComplete(): void {
		// Update stats display after a brief delay
		setTimeout(() => {
			this.updateRAGStatus();
		}, 1000);
	}
} 