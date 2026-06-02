const readline = require('readline');

class ProgressUI {
  constructor() {
    this.isTTY = process.stdout.isTTY;
    this.stage = '';
    this.progress = 0;
    this.subLine = '';
    this.eta = '';
    this.startedAt = Date.now();
    this.lastRender = 0;
    this.renderedCount = 0;
  }

  _render() {
    if (!this.isTTY) return;
    const now = Date.now();
    if (now - this.lastRender < 300) return;
    this.lastRender = now;

    const barWidth = 30;
    const filled = Math.round(this.progress / 100 * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const pct = this.progress.toFixed(0);

    const lines = [
      `${this.stageIcon} ${this.stage}:`,
      `  ${bar}  ${this.subLine}`,
      this.eta ? `  ${this.eta}` : '',
    ].filter(Boolean);

    if (this.renderedCount === 0) {
      console.log(lines.join('\n'));
      this.renderedCount = lines.length;
    } else {
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
      process.stdout.write(lines.join('\n') + '\n');
    }
  }

  setStage(stage, icon) {
    this.stage = stage;
    this.stageIcon = icon || '●';
    this.progress = 0;
    this.subLine = '';
    this.eta = '';
    this._render();
  }

  update(progress, subLine, eta) {
    this.progress = Math.min(progress, 100);
    if (subLine !== undefined) this.subLine = subLine;
    if (eta !== undefined) this.eta = eta;
    this._render();
  }

  done() {
    this.progress = 100;
    this._render();
  }

  log(msg) {
    if (this.isTTY) {
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
      console.log(msg);
      this.renderedCount = 1;
    } else {
      console.log(msg);
    }
  }

  summary(title, details) {
    if (this.isTTY) {
      readline.moveCursor(process.stdout, 0, -this.renderedCount);
      readline.clearScreenDown(process.stdout);
    }
    console.log(`\n✅ ${title}`);
    details.forEach(d => console.log(`   ${d}`));
    console.log();
  }
}

module.exports = ProgressUI;