import { FileIcon, FolderClosedIcon, FolderOpenIcon } from "lucide-react";

interface IconProps {
  size?: number;
}

/** Tree icons: muted 15px strokes, per the shadcn file-tree form. */
const DEFAULT_SIZE = 15;

export function TreeFolderIcon({ size = DEFAULT_SIZE, open = false }: IconProps & { open?: boolean }) {
  const Icon = open ? FolderOpenIcon : FolderClosedIcon;
  return <Icon size={size} strokeWidth={1.8} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function GenericFileIcon({ size = DEFAULT_SIZE }: IconProps) {
  return <FileIcon size={size} strokeWidth={1.8} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function getFileIcon(_name: string, size = DEFAULT_SIZE): React.ReactNode {
  return <GenericFileIcon size={size} />;
}

/** Closed-folder alias kept for the callers that render one folder glyph. */
export const FolderIcon = TreeFolderIcon;
