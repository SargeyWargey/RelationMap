export type GraphNode = {
  id: string;
  name: string;
  databaseId: string;
  databaseName: string;
  color: string;
  notionUrl: string;
  createdBy: string;
  createdTime: string;
  x: number;
  y: number;
  fieldValues?: NodeFieldValues;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relationName: string;
};

export type GraphData = {
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings?: string[];
};

export type NodeFieldValues = Record<
  string, // property name
  string | string[] | null // rendered value(s) — null if missing
>;

export type NodeDetail = {
  id: string;
  name: string;
  createdBy: string;
  createdTime: string;
  databaseName: string;
  databaseId: string;
  notionUrl: string;
  description?: string;
  fieldValues?: NodeFieldValues;
};

export type FieldOption = {
  id: string;
  name: string;
  color: string;
};

export type NotionFieldType =
  | "title" | "rich_text" | "select" | "multi_select"
  | "status" | "number" | "date" | "checkbox"
  | "people" | "email" | "phone_number" | "url"
  | "relation" | "formula" | "rollup" | "files"
  | "created_time" | "created_by" | "last_edited_time" | "last_edited_by"
  | string;

export type DatabaseField = {
  id: string;
  name: string;
  type: NotionFieldType;
  options?: FieldOption[];
};

export type DatabaseSchema = {
  databaseId: string;
  databaseName: string;
  fields: DatabaseField[];
};

export type DatabaseFieldConfig = {
  panelVisible: Record<string, boolean>;
  sphereField: string | null;
  activeFilters: Record<string, string[]>;
  databaseColor?: string;
  nameField?: string | null;    // Project Timeline: field used to extract person names
  detailField?: string | null;  // Project Timeline: secondary text field shown below card title
};

export type NotionWorkspace = {
  id: string;
  name: string;
  notionToken: string;
  rootPages: string[];
};

export type CultureConfig = {
  playbackSpeed: number;   // months per second (default: 1)
  showRelations: boolean;  // default: true
  nodeSizeScale: number;   // multiplier (default: 1)
};

export type AppConfig = {
  databaseColors: Record<string, string>;
  lastSyncAt?: string;
  // Legacy single-workspace fields (kept for sync compat — mirrors active workspace)
  notionToken?: string;
  rootPages?: string[];
  // Multi-workspace support
  workspaces?: NotionWorkspace[];
  activeWorkspaceId?: string;
  fieldConfig?: Record<string, DatabaseFieldConfig>;
  orreryConfig?: import("./orreryTypes").OrreryConfig;
  cultureConfig?: CultureConfig;
};
