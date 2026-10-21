// Serial refreshes with revision invalidation. A change during an active read
// queues exactly one replacement; the old result can never reach the UI.
export class RefreshSlot {
    constructor(fetch, publish) {
        this._fetch = fetch;
        this._publish = publish;
        this._revision = 0;
        this._active = false;
        this._pending = false;
        this._destroyed = false;
    }

    invalidate() {
        this._revision++;
        this._pending = false;
    }

    async refresh(replace = false) {
        if (this._destroyed)
            return;
        if (this._active) {
            this._pending ||= replace;
            return;
        }
        this._active = true;
        const revision = this._revision;
        try {
            const value = await this._fetch();
            if (!this._destroyed && revision === this._revision)
                this._publish(value);
        } finally {
            this._active = false;
            if (this._pending && !this._destroyed) {
                this._pending = false;
                await this.refresh();
            }
        }
    }

    destroy() {
        this.invalidate();
        this._destroyed = true;
        this._fetch = null;
        this._publish = null;
    }
}
