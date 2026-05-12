import {
  type INodeType,
  type INodeTypeDescription,
  type IPollFunctions,
  type INodeExecutionData,
  type IDataObject,
  type NodeConnectionType,
} from 'n8n-workflow';
import { plaudRequest } from './transport';

interface FileListItem {
  id: string;
  filename: string;
  filesize: number;
  duration: number;
  start_time: number;
  version_ms: number;
  is_trans: boolean;
  is_summary: boolean;
  is_trash: boolean;
}

interface NodeStaticData {
  /** Largest version_ms seen so far. New items have version_ms > cursor. */
  cursorVersionMs?: number;
  /** Per-event book-keeping for "transcript ready" event so we don't re-fire on the same id. */
  seenTranscriptIds?: string[];
}

const MAX_REMEMBERED_TRANSCRIPT_IDS = 500;

export class PlaudTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Plaud Trigger',
    name: 'plaudTrigger',
    icon: 'file:plaud.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description: 'Polls Plaud for new recordings or newly available transcripts',
    defaults: { name: 'Plaud Trigger' },
    polling: true,
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'plaudApi', required: true }],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        default: 'newRecording',
        options: [
          {
            name: 'New Recording',
            value: 'newRecording',
            description: 'Fires whenever a new recording appears in the library',
          },
          {
            name: 'New Transcript Available',
            value: 'newTranscript',
            description: 'Fires when a recording transitions from "no transcript" to "transcript ready"',
          },
        ],
      },
      {
        displayName: 'Include Trashed',
        name: 'includeTrashed',
        type: 'boolean',
        default: false,
        description: 'Whether to include recordings currently in the trash',
      },
    ],
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const event = this.getNodeParameter('event') as 'newRecording' | 'newTranscript';
    const includeTrashed = this.getNodeParameter('includeTrashed') as boolean;
    const staticData = this.getWorkflowStaticData('node') as NodeStaticData;

    const res = await plaudRequest<{ data_file_list: FileListItem[] }>(
      this,
      'GET',
      '/file/simple/web',
    );
    const files = (res.data_file_list ?? []).filter((f) => includeTrashed || !f.is_trash);

    // First poll ever: just record the cursor, don't fire.
    if (staticData.cursorVersionMs === undefined) {
      staticData.cursorVersionMs = files.reduce((m, f) => Math.max(m, f.version_ms ?? 0), 0);
      staticData.seenTranscriptIds = files.filter((f) => f.is_trans).map((f) => f.id);
      return null;
    }

    let toEmit: FileListItem[] = [];

    if (event === 'newRecording') {
      const cursor = staticData.cursorVersionMs;
      toEmit = files.filter((f) => (f.version_ms ?? 0) > cursor);
      const newCursor = toEmit.reduce((m, f) => Math.max(m, f.version_ms ?? 0), cursor);
      staticData.cursorVersionMs = newCursor;
    } else {
      // newTranscript: emit any file that has is_trans=true and we haven't emitted before.
      const seen = new Set(staticData.seenTranscriptIds ?? []);
      toEmit = files.filter((f) => f.is_trans && !seen.has(f.id));
      // Update the seen set, capped to MAX_REMEMBERED_TRANSCRIPT_IDS to avoid unbounded growth.
      const updated = [...seen, ...toEmit.map((f) => f.id)];
      staticData.seenTranscriptIds = updated.slice(-MAX_REMEMBERED_TRANSCRIPT_IDS);
      // Also advance the version cursor so a future switch to "newRecording" mode is sane.
      staticData.cursorVersionMs = files.reduce(
        (m, f) => Math.max(m, f.version_ms ?? 0),
        staticData.cursorVersionMs,
      );
    }

    if (toEmit.length === 0) return null;

    return [toEmit.map((f) => ({ json: f as unknown as IDataObject }))];
  }
}
