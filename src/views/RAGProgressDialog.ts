import { App, ProgressBarComponent } from 'obsidian';

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
		this.containerEl = activeDocument.body.createDiv({
			cls: 'rag-progress-floating-dialog'
		});

		// Title with drag handle
		const titleEl = this.containerEl.createDiv({
			cls: 'rag-progress-title',
			text: 'Building Semantic Search Index'
		});

		// Message
		this.messageEl = this.containerEl.createDiv({
			text: 'Preparing...',
			cls: 'rag-progress-message'
		});

		// Progress bar container
		const progressContainer = this.containerEl.createDiv({
			cls: 'rag-progress-container'
		});

		// Create progress bar
		this.progressBar = new ProgressBarComponent(progressContainer);
		this.progressBar.setValue(0);

		// Button container
		const buttonContainer = this.containerEl.createDiv({
			cls: 'rag-progress-buttons'
		});

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
		this.closeButton.addClass('rag-progress-button-hidden');
		
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
		const minimizeBtn = titleEl.createSpan({
			text: '−',
			cls: 'rag-progress-minimize'
		});

		let isMinimized = false;
		minimizeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			isMinimized = !isMinimized;
			
			if (isMinimized) {
				this.containerEl.classList.add('minimized');
				minimizeBtn.textContent = '+';
			} else {
				this.containerEl.classList.remove('minimized');
				minimizeBtn.textContent = '−';
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
			newX = Math.max(0, Math.min(newX, activeWindow.innerWidth - rect.width));
			newY = Math.max(0, Math.min(newY, activeWindow.innerHeight - rect.height));
			
			// Use CSS custom properties for positioning
			this.containerEl.style.setProperty('--dialog-left', `${newX}px`);
			this.containerEl.style.setProperty('--dialog-top', `${newY}px`);
			this.containerEl.classList.add('dragging');
			
			e.preventDefault();
		};

		const onMouseUp = () => {
			isDragging = false;
			this.containerEl.classList.remove('dragging');
		};

		titleEl.addEventListener('mousedown', onMouseDown);
		activeDocument.addEventListener('mousemove', onMouseMove);
		activeDocument.addEventListener('mouseup', onMouseUp);

		// Store cleanup functions
		this.cleanupFunctions.push(() => {
			activeDocument.removeEventListener('mousemove', onMouseMove);
			activeDocument.removeEventListener('mouseup', onMouseUp);
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
		this.cancelButton.addClass('rag-progress-button-hidden');
		this.closeButton.removeClass('rag-progress-button-hidden');
		
		// Auto-close after 5 seconds
		activeWindow.setTimeout(() => {
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
		this.messageEl.classList.add('error');
		
		// Hide cancel button, show close button
		this.cancelButton.addClass('rag-progress-button-hidden');
		this.closeButton.removeClass('rag-progress-button-hidden');
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
