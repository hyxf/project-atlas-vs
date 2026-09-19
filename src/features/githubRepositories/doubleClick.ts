export class DoubleClickTracker {
    private lastItemId: string | undefined;
    private lastClickAt = 0;

    constructor(private readonly intervalMs = 500) {}

    register(itemId: string, clickedAt = Date.now()): boolean {
        const isDoubleClick = this.lastItemId === itemId && clickedAt - this.lastClickAt <= this.intervalMs;
        this.lastItemId = isDoubleClick ? undefined : itemId;
        this.lastClickAt = isDoubleClick ? 0 : clickedAt;
        return isDoubleClick;
    }
}
