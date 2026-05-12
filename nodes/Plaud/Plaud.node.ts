import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type IDataObject,
  type NodeConnectionType,
  NodeOperationError,
} from 'n8n-workflow';
import { fetchPresignedS3, plaudRequest } from './transport';

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
  filetag_id_list: string[];
}

interface FileDetailContentItem {
  data_id: string;
  data_type: string;
  data_title: string;
  data_link: string;
  task_status: number;
}

interface FileDetail {
  file_id: string;
  file_name: string;
  duration: number;
  content_list: FileDetailContentItem[];
  pre_download_content_list?: Array<{ data_id: string; data_content: string }>;
}

interface PartUploadInfo {
  part_urls: string[];
  upload_id: string;
  object_name: string;
}

const TRANSCRIPT_DATA_TYPES = ['transaction', 'transcript'] as const;
const SUMMARY_DATA_TYPES = ['auto_sum_note', 'summary'] as const;

export class Plaud implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Plaud',
    name: 'plaud',
    icon: 'file:plaud.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Read recordings, transcripts and summaries from Plaud (plaud.ai)',
    defaults: { name: 'Plaud' },
    inputs: ['main' as NodeConnectionType],
    outputs: ['main' as NodeConnectionType],
    credentials: [{ name: 'plaudApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'recording',
        options: [
          { name: 'Recording', value: 'recording' },
          { name: 'Transcript', value: 'transcript' },
          { name: 'Summary', value: 'summary' },
          { name: 'Account', value: 'account' },
          { name: 'Upload', value: 'upload' },
          { name: 'Tag', value: 'tag' },
          { name: 'Device', value: 'device' },
        ],
      },

      // ─── Recording operations ─────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: { show: { resource: ['recording'] } },
        options: [
          { name: 'Get Many', value: 'getAll', action: 'List recordings', description: 'List all recordings in the account' },
          { name: 'Get', value: 'get', action: 'Get a recording', description: 'Get the metadata + content links for one recording' },
          { name: 'Update Filename', value: 'updateFilename', action: 'Rename a recording' },
          { name: 'Trash (Soft Delete)', value: 'trash', action: 'Move recording to trash' },
          { name: 'Delete (Hard)', value: 'delete', action: 'Permanently delete a recording' },
          { name: 'Get Download URL', value: 'downloadUrl', action: 'Get a presigned audio download URL' },
          { name: 'Download Audio', value: 'downloadAudio', action: 'Download the audio as binary data' },
        ],
      },
      {
        displayName: 'Recording ID',
        name: 'recordingId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['recording'], operation: ['get', 'updateFilename', 'trash', 'delete', 'downloadUrl', 'downloadAudio'] },
        },
        description: 'The 32-char hex `id` from the recordings list',
      },
      {
        displayName: 'New Filename',
        name: 'newFilename',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['recording'], operation: ['updateFilename'] } },
        description: 'New display name for the recording (without extension)',
      },
      {
        displayName: 'Include Trashed',
        name: 'includeTrashed',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['recording'], operation: ['getAll'] } },
        description: 'Whether to include recordings in the trash',
      },
      {
        displayName: 'Binary Property',
        name: 'binaryProperty',
        type: 'string',
        default: 'data',
        displayOptions: { show: { resource: ['recording'], operation: ['downloadAudio'] } },
        description: 'Name of the output binary property to write the audio file to',
      },

      // ─── Transcript / Summary operations ──────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'get',
        displayOptions: { show: { resource: ['transcript', 'summary'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get the content for a recording' },
        ],
      },
      {
        displayName: 'Recording ID',
        name: 'recordingId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['transcript', 'summary'] } },
      },

      // ─── Account operations ───────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getProfile',
        displayOptions: { show: { resource: ['account'] } },
        options: [
          { name: 'Get Profile', value: 'getProfile', action: 'Get the account profile' },
        ],
      },

      // ─── Upload operations ────────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'upload',
        displayOptions: { show: { resource: ['upload'] } },
        options: [
          { name: 'Upload Audio', value: 'upload', action: 'Upload an audio file to Plaud' },
        ],
      },
      {
        displayName: 'Binary Property',
        name: 'binaryProperty',
        type: 'string',
        default: 'data',
        required: true,
        displayOptions: { show: { resource: ['upload'], operation: ['upload'] } },
        description: 'Name of the input binary property containing the audio file (.ogg / .m4a / .mp3 / .wav)',
      },
      {
        displayName: 'Filename',
        name: 'filename',
        type: 'string',
        default: '={{$now.format("yyyy-MM-dd HH:mm:ss")}}',
        required: true,
        displayOptions: { show: { resource: ['upload'], operation: ['upload'] } },
        description: 'Display name for the recording in Plaud (without extension)',
      },
      {
        displayName: 'Recording Start Time',
        name: 'startTime',
        type: 'dateTime',
        default: '',
        displayOptions: { show: { resource: ['upload'], operation: ['upload'] } },
        description: 'When the recording was made. Defaults to now if empty.',
      },

      // ─── Tag operations ───────────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: { show: { resource: ['tag'] } },
        options: [
          { name: 'Get Many', value: 'getAll', action: 'List file tags' },
        ],
      },

      // ─── Device operations ────────────────────────────────────────────────
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'getAll',
        displayOptions: { show: { resource: ['device'] } },
        options: [
          { name: 'Get Many', value: 'getAll', action: 'List devices', description: 'List all Plaud devices linked to the account' },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;

        if (resource === 'recording') {
          out.push(...(await runRecording.call(this, i, operation, items[i]!)));
        } else if (resource === 'transcript') {
          out.push(await runTranscript.call(this, i));
        } else if (resource === 'summary') {
          out.push(await runSummary.call(this, i));
        } else if (resource === 'account') {
          out.push(await runAccount.call(this, i));
        } else if (resource === 'upload') {
          out.push(await runUpload.call(this, i, items[i]!));
        } else if (resource === 'tag') {
          out.push(await runTag.call(this, i));
        } else if (resource === 'device') {
          out.push(...(await runDevice.call(this, i)));
        } else {
          throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`);
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (error as Error).message }, pairedItem: i });
          continue;
        }
        throw error;
      }
    }

    return [out];
  }
}

// ─── Resource runners ──────────────────────────────────────────────────────────

async function runRecording(
  this: IExecuteFunctions,
  i: number,
  operation: string,
  inputItem: INodeExecutionData,
): Promise<INodeExecutionData[]> {
  switch (operation) {
    case 'getAll': {
      const includeTrashed = this.getNodeParameter('includeTrashed', i) as boolean;
      const res = await plaudRequest<{ data_file_list: FileListItem[]; data_file_total: number }>(
        this,
        'GET',
        '/file/simple/web',
      );
      const list = (res.data_file_list ?? []).filter((f) => includeTrashed || !f.is_trash);
      return list.map((file) => ({ json: file as unknown as IDataObject, pairedItem: i }));
    }
    case 'get': {
      const id = requireRecordingId(this, i);
      const detail = await plaudRequest<FileDetail>(this, 'GET', `/file/detail/${id}`);
      return [{ json: detail as unknown as IDataObject, pairedItem: i }];
    }
    case 'updateFilename': {
      const id = requireRecordingId(this, i);
      const newFilename = (this.getNodeParameter('newFilename', i) as string).trim();
      if (!newFilename) {
        throw new NodeOperationError(this.getNode(), 'New Filename is required', { itemIndex: i });
      }
      const res = await plaudRequest(this, 'PATCH', `/file/${id}`, {
        body: { filename: newFilename } as IDataObject,
      });
      return [{ json: { id, filename: newFilename, response: res as unknown as IDataObject }, pairedItem: i }];
    }
    case 'trash': {
      const id = requireRecordingId(this, i);
      const res = await plaudRequest(this, 'POST', '/file/trash/', { body: [id] as unknown as IDataObject });
      return [{ json: { ok: true, id, response: res as unknown as IDataObject }, pairedItem: i }];
    }
    case 'delete': {
      const id = requireRecordingId(this, i);
      const res = await plaudRequest(this, 'DELETE', '/file/', { body: [id] as unknown as IDataObject });
      return [{ json: { ok: true, id, response: res as unknown as IDataObject }, pairedItem: i }];
    }
    case 'downloadUrl': {
      const id = requireRecordingId(this, i);
      const res = await plaudRequest<{ temp_url: string; temp_url_opus: string | null }>(
        this,
        'GET',
        `/file/temp-url/${id}`,
      );
      return [{ json: { id, ...res } as unknown as IDataObject, pairedItem: i }];
    }
    case 'downloadAudio': {
      const id = requireRecordingId(this, i);
      const binaryProp = this.getNodeParameter('binaryProperty', i) as string;
      const meta = await plaudRequest<{ temp_url: string }>(this, 'GET', `/file/temp-url/${id}`);
      if (!meta?.temp_url) throw new NodeOperationError(this.getNode(), `No temp_url returned for recording ${id}`);
      const buf = await fetchPresignedS3<Buffer>(this, meta.temp_url, true);
      const item: INodeExecutionData = {
        json: { id, source_url: meta.temp_url.split('?')[0] },
        binary: {
          [binaryProp]: await this.helpers.prepareBinaryData(buf, `${id}.ogg`, 'audio/ogg'),
        },
        pairedItem: i,
      };
      return [item];
    }
    default:
      throw new NodeOperationError(this.getNode(), `Unknown recording operation "${operation}"`);
  }
}

async function runTranscript(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
  const id = requireRecordingId(this, i);
  const link = await findContentLink.call(this, id, TRANSCRIPT_DATA_TYPES, 'transcript');
  const transcript = await fetchPresignedS3<unknown>(this, link, false);
  return {
    json: { recording_id: id, transcript: transcript as IDataObject },
    pairedItem: i,
  };
}

async function runSummary(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
  const id = requireRecordingId(this, i);
  const link = await findContentLink.call(this, id, SUMMARY_DATA_TYPES, 'summary');
  // Summary content is gzipped markdown. Fetch as buffer and try to gunzip;
  // fall back to raw bytes-as-text if it isn't actually gzipped.
  const buf = await fetchPresignedS3<Buffer>(this, link, true);
  const markdown = maybeGunzipToString(buf);
  return {
    json: { recording_id: id, summary_markdown: markdown },
    pairedItem: i,
  };
}

async function runAccount(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
  const profile = await plaudRequest<IDataObject>(this, 'GET', '/user-app/profile/account/me');
  return { json: profile, pairedItem: i };
}

async function runUpload(
  this: IExecuteFunctions,
  i: number,
  inputItem: INodeExecutionData,
): Promise<INodeExecutionData> {
  const binaryProp = this.getNodeParameter('binaryProperty', i) as string;
  const filename = this.getNodeParameter('filename', i) as string;
  const startTimeIso = this.getNodeParameter('startTime', i, '') as string;
  const startTimeMs = startTimeIso ? new Date(startTimeIso).getTime() : Date.now();

  const binary = inputItem.binary?.[binaryProp];
  if (!binary) {
    throw new NodeOperationError(
      this.getNode(),
      `Input item has no binary property "${binaryProp}". Set "Binary Property" to the field your previous node writes the audio to.`,
    );
  }
  const audioBuf = await this.helpers.getBinaryDataBuffer(i, binaryProp);
  const fileType = inferFileType(binary.fileName ?? '', binary.mimeType ?? '');

  // 1. Get presigned multipart URLs.
  const presigned = await plaudRequest<PartUploadInfo>(
    this,
    'POST',
    '/file/get_upload_presigned_url',
    { body: { filesize: audioBuf.length, file_type: fileType } as IDataObject },
  );
  if (!presigned?.part_urls?.length) {
    throw new NodeOperationError(this.getNode(), 'Plaud did not return any presigned upload URLs');
  }

  // 2. Split the buffer evenly across the parts and PUT each one.
  const parts: Array<{ Etag: string; PartNumber: number }> = [];
  const partSize = Math.ceil(audioBuf.length / presigned.part_urls.length);
  for (let p = 0; p < presigned.part_urls.length; p++) {
    const start = p * partSize;
    const end = Math.min(start + partSize, audioBuf.length);
    const chunk = audioBuf.subarray(start, end);
    const partUrl = presigned.part_urls[p]!;
    // Use this.helpers.request directly so we get the response headers (need ETag).
    const response = await this.helpers.request({
      method: 'PUT',
      uri: partUrl,
      body: chunk,
      headers: { 'Content-Length': chunk.length.toString() },
      resolveWithFullResponse: true,
    } as unknown as Parameters<typeof this.helpers.request>[0]) as { headers: Record<string, string> };
    const etag = (response.headers?.etag ?? response.headers?.ETag ?? '').replace(/"/g, '');
    if (!etag) throw new NodeOperationError(this.getNode(), `S3 part ${p + 1} did not return an ETag`);
    parts.push({ Etag: etag, PartNumber: p + 1 });
  }

  // 3. Tell Plaud to merge the parts.
  await plaudRequest(this, 'POST', '/file/merge_multipart', {
    body: { upload_id: presigned.upload_id, object_name: presigned.object_name, parts } as unknown as IDataObject,
  });

  // 4. Confirm the upload to register the file in the user's library.
  const confirmed = await plaudRequest<IDataObject>(this, 'POST', '/file/confirm_upload', {
    body: {
      upload_id: presigned.upload_id,
      object_name: presigned.object_name,
      scene: 1,
      is_tmp: 0,
      support_mul_summ: true,
      file_type: fileType,
      filename,
      start_time: startTimeMs,
      session_id: 0,
      serial_number: '',
      timezone: -new Date().getTimezoneOffset() / 60,
    } as IDataObject,
  });

  return { json: confirmed, pairedItem: i };
}

async function runTag(this: IExecuteFunctions, i: number): Promise<INodeExecutionData> {
  const tags = await plaudRequest<IDataObject>(this, 'GET', '/filetag/');
  return { json: tags, pairedItem: i };
}

async function runDevice(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const res = await plaudRequest<{ data_devices?: IDataObject[] } | IDataObject[]>(
    this,
    'GET',
    '/device/list',
  );
  // Plaud returns `{ data_devices: [...] }` here. The transport helper already unwraps
  // the outer `data` field for endpoints that have one — this endpoint puts the array
  // at the top level alongside `status`, so we fish out `data_devices` ourselves.
  const devices = Array.isArray(res)
    ? res
    : ((res as { data_devices?: IDataObject[] }).data_devices ?? []);
  if (devices.length === 0) return [{ json: { devices: [] }, pairedItem: i }];
  return devices.map((d) => ({ json: d, pairedItem: i }));
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

function requireRecordingId(ctx: IExecuteFunctions, i: number): string {
  const id = (ctx.getNodeParameter('recordingId', i) as string).trim();
  if (!id) throw new NodeOperationError(ctx.getNode(), 'Recording ID is required for this operation', { itemIndex: i });
  return id;
}

async function findContentLink(
  this: IExecuteFunctions,
  recordingId: string,
  dataTypes: readonly string[],
  label: string,
): Promise<string> {
  const detail = await plaudRequest<FileDetail>(this, 'GET', `/file/detail/${recordingId}`);
  const item = detail.content_list?.find((c) => dataTypes.includes(c.data_type));
  if (!item) {
    throw new NodeOperationError(
      this.getNode(),
      `No ${label} available for recording ${recordingId} (content_list types: ${(detail.content_list ?? []).map((c) => c.data_type).join(', ') || 'none'})`,
    );
  }
  if (item.task_status !== 1) {
    throw new NodeOperationError(
      this.getNode(),
      `${label} for recording ${recordingId} is not ready yet (task_status=${item.task_status})`,
    );
  }
  if (!item.data_link) {
    throw new NodeOperationError(this.getNode(), `${label} for recording ${recordingId} has no data_link`);
  }
  return item.data_link;
}

function maybeGunzipToString(buf: Buffer): string {
  // Magic bytes 1F 8B → gzip
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const { gunzipSync } = require('node:zlib') as typeof import('node:zlib');
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

function inferFileType(fileName: string, mimeType: string): string {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.ogg') || mimeType.includes('ogg')) return 'ogg';
  if (lower.endsWith('.m4a') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a';
  if (lower.endsWith('.mp3') || mimeType.includes('mpeg')) return 'mp3';
  if (lower.endsWith('.wav') || mimeType.includes('wav')) return 'wav';
  if (lower.endsWith('.opus') || mimeType.includes('opus')) return 'opus';
  return 'ogg'; // Plaud's native format
}
