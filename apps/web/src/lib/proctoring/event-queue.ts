import type {
    ProctoringEventInput,
    ProctoringEventType,
} from "@interviewforge/shared";
import type { ProctoringEventDraft, QueuedProctoringEvent } from "./types";

const DB_NAME = "practers-proctoring-events";
const DB_VERSION = 1;
const EVENTS_STORE = "events";
const META_STORE = "meta";
const DEFAULT_QUEUE_CAP = 5000;
const DROPPABLE_EVENT_TYPES = new Set<ProctoringEventType>([
    "session_heartbeat",
    "window_blur",
    "contextmenu",
]);

type CounterState = {
    key: string;
    value: number;
};

export type EventQueueStorage = {
    nextCounter(): Promise<number>;
    put(event: QueuedProctoringEvent): Promise<void>;
    get(clientEventId: string): Promise<QueuedProctoringEvent | undefined>;
    list(): Promise<QueuedProctoringEvent[]>;
    deleteMany(clientEventIds: string[]): Promise<void>;
    clear(): Promise<void>;
    close(): void;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(EVENTS_STORE)) {
                const events = db.createObjectStore(EVENTS_STORE, { keyPath: "client_event_id" });
                events.createIndex("session_id", "session_id", { unique: false });
                events.createIndex("queued_at", "queued_at", { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export class IndexedDbEventQueueStorage implements EventQueueStorage {
    private constructor(
        private readonly db: IDBDatabase,
        private readonly sessionId: string
    ) { }

    static async open(sessionId: string): Promise<IndexedDbEventQueueStorage> {
        const db = await openDatabase();
        return new IndexedDbEventQueueStorage(db, sessionId);
    }

    async nextCounter(): Promise<number> {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(META_STORE, "readwrite");
            const store = transaction.objectStore(META_STORE);
            const key = `counter:${this.sessionId}`;
            let next = 1;

            const request = store.get(key);
            request.onsuccess = () => {
                const current = request.result as CounterState | undefined;
                next = (current?.value ?? 0) + 1;
                store.put({ key, value: next });
            };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(next);
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async put(event: QueuedProctoringEvent): Promise<void> {
        const transaction = this.db.transaction(EVENTS_STORE, "readwrite");
        const done = transactionDone(transaction);
        transaction.objectStore(EVENTS_STORE).put(event);
        await done;
    }

    async get(clientEventId: string): Promise<QueuedProctoringEvent | undefined> {
        const transaction = this.db.transaction(EVENTS_STORE, "readonly");
        const done = transactionDone(transaction);
        const result = await requestToPromise<QueuedProctoringEvent | undefined>(
            transaction.objectStore(EVENTS_STORE).get(clientEventId)
        );
        await done;
        return result?.session_id === this.sessionId ? result : undefined;
    }

    async list(): Promise<QueuedProctoringEvent[]> {
        const transaction = this.db.transaction(EVENTS_STORE, "readonly");
        const done = transactionDone(transaction);
        const index = transaction.objectStore(EVENTS_STORE).index("session_id");
        const result = await requestToPromise<QueuedProctoringEvent[]>(index.getAll(this.sessionId));
        await done;
        return sortEvents(result);
    }

    async deleteMany(clientEventIds: string[]): Promise<void> {
        if (!clientEventIds.length) return;
        const transaction = this.db.transaction(EVENTS_STORE, "readwrite");
        const done = transactionDone(transaction);
        const store = transaction.objectStore(EVENTS_STORE);
        for (const id of clientEventIds) {
            store.delete(id);
        }
        await done;
    }

    async clear(): Promise<void> {
        const events = await this.list();
        await this.deleteMany(events.map((event) => event.client_event_id));
    }

    close(): void {
        this.db.close();
    }
}

export class MemoryEventQueueStorage implements EventQueueStorage {
    private counter = 0;
    private events = new Map<string, QueuedProctoringEvent>();

    constructor(private readonly sessionId: string) { }

    async nextCounter(): Promise<number> {
        this.counter += 1;
        return this.counter;
    }

    async put(event: QueuedProctoringEvent): Promise<void> {
        this.events.set(event.client_event_id, event);
    }

    async get(clientEventId: string): Promise<QueuedProctoringEvent | undefined> {
        return this.events.get(clientEventId);
    }

    async list(): Promise<QueuedProctoringEvent[]> {
        return sortEvents([...this.events.values()].filter((event) => event.session_id === this.sessionId));
    }

    async deleteMany(clientEventIds: string[]): Promise<void> {
        for (const id of clientEventIds) {
            this.events.delete(id);
        }
    }

    async clear(): Promise<void> {
        this.events.clear();
    }

    close(): void { }
}

function sortEvents(events: QueuedProctoringEvent[]): QueuedProctoringEvent[] {
    return events.sort((a, b) => a.sequence - b.sequence || a.queued_at - b.queued_at);
}

function isDroppable(event: ProctoringEventInput): boolean {
    return DROPPABLE_EVENT_TYPES.has(event.event_type);
}

export class EventQueue {
    private constructor(
        private readonly sessionId: string,
        private readonly storage: EventQueueStorage,
        private readonly cap: number
    ) { }

    static async open(
        sessionId: string,
        options: { storage?: EventQueueStorage; cap?: number } = {}
    ): Promise<EventQueue> {
        const storage = options.storage
            ?? (typeof indexedDB === "undefined"
                ? new MemoryEventQueueStorage(sessionId)
                : await IndexedDbEventQueueStorage.open(sessionId));
        return new EventQueue(sessionId, storage, options.cap ?? DEFAULT_QUEUE_CAP);
    }

    async enqueue<T extends ProctoringEventType>(
        draft: ProctoringEventDraft<T>
    ): Promise<ProctoringEventInput> {
        const sequence = await this.storage.nextCounter();
        const event = {
            client_event_id: `${this.sessionId}-${sequence}`,
            event_type: draft.event_type,
            payload: draft.payload,
            client_timestamp: new Date().toISOString(),
        } as ProctoringEventInput;

        await this.enqueuePrepared(event, sequence);
        return event;
    }

    async enqueuePrepared(
        event: ProctoringEventInput,
        sequence?: number
    ): Promise<ProctoringEventInput> {
        const existing = await this.storage.get(event.client_event_id);
        if (existing) return existing;

        const resolvedSequence = sequence ?? await this.storage.nextCounter();
        await this.storage.put({
            ...event,
            session_id: this.sessionId,
            queued_at: Date.now(),
            sequence: resolvedSequence,
        });
        await this.enforceCap(event.client_event_id);
        return event;
    }

    async peek(limit = 50): Promise<ProctoringEventInput[]> {
        const events = await this.storage.list();
        return events.slice(0, limit).map(stripQueueFields);
    }

    async markAccepted(clientEventIds: string[]): Promise<void> {
        await this.storage.deleteMany(clientEventIds);
    }

    async markRejected(clientEventIds: string[]): Promise<void> {
        await this.storage.deleteMany(clientEventIds);
    }

    async size(): Promise<number> {
        return (await this.storage.list()).length;
    }

    async clear(): Promise<void> {
        await this.storage.clear();
    }

    close(): void {
        this.storage.close();
    }

    private async enforceCap(newClientEventId: string): Promise<void> {
        let events = await this.storage.list();
        while (events.length > this.cap) {
            const droppable = events.find((event) => isDroppable(event));
            if (!droppable) {
                const newest = events.find((event) => event.client_event_id === newClientEventId);
                if (newest && isDroppable(newest)) {
                    await this.storage.deleteMany([newClientEventId]);
                }
                return;
            }
            await this.storage.deleteMany([droppable.client_event_id]);
            events = await this.storage.list();
        }
    }
}

function stripQueueFields(event: QueuedProctoringEvent): ProctoringEventInput {
    return {
        client_event_id: event.client_event_id,
        event_type: event.event_type,
        payload: event.payload,
        client_timestamp: event.client_timestamp,
    } as ProctoringEventInput;
}
