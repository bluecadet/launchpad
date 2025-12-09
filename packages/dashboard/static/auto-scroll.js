class AutoScroll extends HTMLElement {
  constructor() {
    super();
    this.shouldAutoScroll = true;
    this.observer = null;
  }

  connectedCallback() {
    // Scroll to bottom on initialization
    this.scrollToBottom();

    // Watch for content changes
    this.observer = new MutationObserver(() => {
      if (this.shouldAutoScroll) {
        this.scrollToBottom();
      }
    });

    this.observer.observe(this, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Listen for scroll events to determine if user scrolled up
    this.addEventListener('scroll', this.handleScroll.bind(this));
  }

  disconnectedCallback() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  handleScroll() {
    const threshold = 5; // pixels from bottom to consider "at bottom"
    const isAtBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - threshold;
    this.shouldAutoScroll = isAtBottom;
  }

  scrollToBottom() {
    this.scrollTop = this.scrollHeight;
  }
}

customElements.define("auto-scroll", AutoScroll);