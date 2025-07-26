import { App, ProgressBarComponent } from 'obsidian';
import { LoggingUtility } from './LoggingUtility';

export class RAGProgressDialog {
	private app: App;
	private containerEl: HTMLElement;
	private progressBar: ProgressBarComponent;
	private messageEl: HTMLElement;
	private cancelButton: HTMLButtonElement;
	private closeButton: HTMLButtonElement;
	private onCancel?: () => void;
	private isComplete: boolean = false;
	private isVisible: boolean = false;
	private cleanupFunctions: (() => void)[] = [];

	constructor(app: App, onCancel?: () => void) {
		this.app = app;
		this.onCancel = onCancel;
	}

	/**
	 * Create and show the floating progress dialog
	 */
	open() {
		if (this.isVisible) return;
		
		this.isVisible = true;
		this.createFloatingDialog();
	}

	/**
	 * Create the floating dialog element
	 */
	private createFloatingDialog() {
		// Create main container
		this.containerEl = document.body.createEl('div', {
			cls: 'rag-progress-floating-dialog'
		});

		// Set initial position and styles
		this.containerEl.style.cssText = `
			position: fixed;
			top: 20px;
			right: 20px;
			width: 350px;
			background: var(--background-primary);
			border: 1px solid var(--background-modifier-border);
			border-radius: 8px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
			z-index: 1000;
			padding: 16px;
			font-family: var(--font-interface);
		`;

		// Title with drag handle
		const titleEl = this.containerEl.createEl('div', {
			cls: 'rag-progress-title',
			text: 'Building RAG Database'
		});
		titleEl.style.cssText = `
			font-size: 16px;
			font-weight: 600;
			margin-bottom: 12px;
			cursor: move;
			user-select: none;
			color: var(--text-normal);
		`;

		// Message
		this.messageEl = this.containerEl.createEl('div', {
			text: 'Preparing...',
			cls: 'rag-progress-message'
		});
		this.messageEl.style.cssText = `
			margin-bottom: 12px;
			font-size: 14px;
			color: var(--text-muted);
		`;

		// Progress bar container
		const progressContainer = this.containerEl.createEl('div', {
			cls: 'rag-progress-container'
		});
		progressContainer.style.marginBottom = '16px';

		// Create progress bar
		this.progressBar = new ProgressBarComponent(progressContainer);
		this.progressBar.setValue(0);

		// Button container
		const buttonContainer = this.containerEl.createEl('div', {
			cls: 'rag-progress-buttons'
		});
		buttonContainer.style.cssText = `
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		`;

		// Cancel button
		this.cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel',
			cls: 'mod-warning'
		});
		
		this.cancelButton.addEventListener('click', () => {
			if (this.onCancel && !this.isComplete) {
				this.onCancel();
				this.close();
			}
		});

		// Close button (hidden initially)
		this.closeButton = buttonContainer.createEl('button', {
			text: 'Close',
			cls: 'mod-cta'
		});
		this.closeButton.style.display = 'none';
		
		this.closeButton.addEventListener('click', () => {
			this.close();
		});

		// Make dialog draggable
		this.makeDraggable(titleEl);

		// Add minimize/restore functionality
		this.addMinimizeButton(titleEl);
	}

	/**
	 * Add minimize button to title bar
	 */
	private addMinimizeButton(titleEl: HTMLElement) {
		const minimizeBtn = titleEl.createEl('span', {
			text: '−',
			cls: 'rag-progress-minimize'
		});
		minimizeBtn.style.cssText = `
			float: right;
			cursor: pointer;
			width: 20px;
			height: 20px;
			text-align: center;
			line-height: 18px;
			border-radius: 3px;
			font-weight: bold;
			color: var(--text-muted);
		`;
		
		minimizeBtn.addEventListener('mouseenter', () => {
			minimizeBtn.style.backgroundColor = 'var(--background-modifier-hover)';
		});
		
		minimizeBtn.addEventListener('mouseleave', () => {
			minimizeBtn.style.backgroundColor = 'transparent';
		});

		let isMinimized = false;
		minimizeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			isMinimized = !isMinimized;
			
			const content = this.containerEl.querySelector('.rag-progress-message')?.parentElement;
			if (content) {
				if (isMinimized) {
					content.style.display = 'none';
					minimizeBtn.textContent = '+';
					this.containerEl.style.width = '200px';
				} else {
					content.style.display = 'block';
					minimizeBtn.textContent = '−';
					this.containerEl.style.width = '350px';
				}
			}
		});
	}

	/**
	 * Make the dialog draggable
	 */
	private makeDraggable(titleEl: HTMLElement) {
		let isDragging = false;
		let startX = 0;
		let startY = 0;
		let initialX = 0;
		let initialY = 0;

		const onMouseDown = (e: MouseEvent) => {
			// Don't drag if clicking minimize button
			if ((e.target as HTMLElement).classList.contains('rag-progress-minimize')) {
				return;
			}
			
			isDragging = true;
			startX = e.clientX;
			startY = e.clientY;
			
			const rect = this.containerEl.getBoundingClientRect();
			initialX = rect.left;
			initialY = rect.top;
			
			e.preventDefault();
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			
			const deltaX = e.clientX - startX;
			const deltaY = e.clientY - startY;
			
			let newX = initialX + deltaX;
			let newY = initialY + deltaY;
			
			// Keep within viewport bounds
			const rect = this.containerEl.getBoundingClientRect();
			newX = Math.max(0, Math.min(newX, window.innerWidth - rect.width));
			newY = Math.max(0, Math.min(newY, window.innerHeight - rect.height));
			
			this.containerEl.style.left = `${newX}px`;
			this.containerEl.style.top = `${newY}px`;
			this.containerEl.style.right = 'auto';
			
			e.preventDefault();
		};

		const onMouseUp = () => {
			isDragging = false;
		};

		titleEl.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);

		// Store cleanup functions
		this.cleanupFunctions.push(() => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		});
	}

	/**
	 * Update progress
	 */
	updateProgress(current: number, total: number, message: string) {
		if (!this.isVisible) return;
		
		if (total > 0) {
			const percentage = (current / total) * 100;
			this.progressBar.setValue(percentage);
			this.messageEl.setText(`${message} (${current}/${total})`);
		} else {
			this.messageEl.setText(message);
		}
	}

	/**
	 * Mark as complete
	 */
	complete(message?: string) {
		if (!this.isVisible) return;
		
		this.isComplete = true;
		this.progressBar.setValue(100);
		this.messageEl.setText(message || 'Complete!');
		
		// Hide cancel button, show close button
		this.cancelButton.style.display = 'none';
		this.closeButton.style.display = 'inline-block';
		
		// Auto-close after 5 seconds
		setTimeout(() => {
			if (this.isVisible) {
				this.close();
			}
		}, 1000);
	}

	/**
	 * Show error
	 */
	showError(error: string) {
		if (!this.isVisible) return;
		
		this.isComplete = true;
		this.messageEl.setText(`Error: ${error}`);
		this.messageEl.style.color = 'var(--text-error)';
		
		// Hide cancel button, show close button
		this.cancelButton.style.display = 'none';
		this.closeButton.style.display = 'inline-block';
	}

	/**
	 * Close the dialog
	 */
	close() {
		if (!this.isVisible) return;
		
		this.isVisible = false;
		
		// Remove from DOM
		if (this.containerEl && this.containerEl.parentNode) {
			this.containerEl.parentNode.removeChild(this.containerEl);
		}
		
		// Run cleanup functions
		this.cleanupFunctions.forEach(fn => fn());
		this.cleanupFunctions = [];
	}
} 