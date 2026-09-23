import React from "react";
import {
  LayoutDashboard,
  PenTool,
  Send,
  FileText,
  FileSignature,
  FileCheck,
  Folder,
  FolderArchive,
  FilePenLine,
  Clock,
  ListTodo,
  CheckCircle2,
  FileEdit,
  XCircle,
  Hourglass,
  Contact,
  Settings,
  Key,
  Globe,
  Users,
  Sliders,
  Menu as MenuIcon,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronLeft,
  ArrowLeft,
  BookOpen,
  User,
  Lock,
  CheckSquare,
  Moon,
  Sun,
  LogOut,
  Maximize,
  Minimize,
  Eye,
  EyeOff,
  Trash2,
  Download,
  Upload,
  CloudUpload,
  Calendar,
  Plus,
  Minus,
  Search,
  Filter,
  RefreshCw,
  HelpCircle,
  Info,
  AlertTriangle,
  Copy,
  X
} from "lucide-react";

// Registro explícito de íconos para garantizar tree-shaking y resolución semántica
const ICON_MAP = {
  // Navegación y Sidebar
  "dashboard": LayoutDashboard,
  "layout-dashboard": LayoutDashboard,
  "sign-yourself": PenTool,
  "pen-tool": PenTool,
  "send": Send,
  "paper-plane": Send,
  "templates": FileText,
  "file-text": FileText,
  "create-template": FileSignature,
  "file-signature": FileSignature,
  "manage-templates": FileCheck,
  "file-check": FileCheck,
  "drive": Folder,
  "folder": Folder,
  "documents": FolderArchive,
  "folder-archive": FolderArchive,
  "need-sign": FilePenLine,
  "in-progress": Clock,
  "clock": Clock,
  "list-todo": ListTodo,
  "completed": CheckCircle2,
  "check-circle": CheckCircle2,
  "drafts": FileEdit,
  "file-edit": FileEdit,
  "declined": XCircle,
  "x-circle": XCircle,
  "expired": Hourglass,
  "hourglass": Hourglass,
  "contactbook": Contact,
  "contact": Contact,
  "settings": Settings,
  "my-signature": PenTool,
  "api-token": Key,
  "key": Key,
  "webhook": Globe,
  "globe": Globe,
  "users": Users,
  "preferences": Sliders,
  "sliders": Sliders,

  // Header y Acciones Globales
  "menu": MenuIcon,
  "bars": MenuIcon,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevron-left": ChevronLeft,
  "arrow-left": ArrowLeft,
  "back": ArrowLeft,
  "angle-down": ChevronDown,
  "angle-right": ChevronRight,
  "book": BookOpen,
  "book-open": BookOpen,
  "user": User,
  "lock": Lock,
  "check-square": CheckSquare,
  "moon": Moon,
  "sun": Sun,
  "log-out": LogOut,
  "logout": LogOut,
  "maximize": Maximize,
  "minimize": Minimize,

  // Utilidades generales
  "eye": Eye,
  "eye-off": EyeOff,
  "trash": Trash2,
  "trash-2": Trash2,
  "download": Download,
  "upload": Upload,
  "cloud-upload": CloudUpload,
  "upload-cloud": CloudUpload,
  "calendar": Calendar,
  "plus": Plus,
  "minus": Minus,
  "search": Search,
  "filter": Filter,
  "refresh": RefreshCw,
  "help": HelpCircle,
  "question": HelpCircle,
  "info": Info,
  "alert": AlertTriangle,
  "copy": Copy,
  "x": X,
  "close": X,
  "times": X,
  "x-mark": X,

  // Aliases retrocompatibles con FontAwesome strings
  "fa-times": X,
  "fa-xmark": X,
  "fa-close": X,
  "fa-tachometer-alt": LayoutDashboard,
  "fa-pen-nib": PenTool,
  "fa-paper-plane": Send,
  "fa-newspaper": FileText,
  "fa-file-signature": FileSignature,
  "fa-file-contract": FileCheck,
  "fa-folder": Folder,
  "fa-address-card": FolderArchive,
  "fa-signature": FilePenLine,
  "fa-tasks": Clock,
  "fa-check-circle": CheckCircle2,
  "fa-edit": FileEdit,
  "fa-times-circle": XCircle,
  "fa-hourglass-end": Hourglass,
  "fa-address-book": Contact,
  "fa-cog": Settings,
  "fa-pen-fancy": PenTool,
  "fa-key": Key,
  "fa-globe": Globe,
  "fa-users": Users,
  "fa-sliders": Sliders,
  "fa-bars": MenuIcon,
  "fa-angle-down": ChevronDown,
  "fa-angle-right": ChevronRight,
  "fa-book": BookOpen,
  "fa-user": User,
  "fa-lock": Lock,
  "fa-check-square": CheckSquare,
  "fa-moon": Moon,
  "fa-arrow-right-from-bracket": LogOut,
  "fa-maximize": Maximize,
  "fa-compress": Minimize,
  "fa-question": HelpCircle,
  "fa-calendar": Calendar,
  "fa-cloud-upload-alt": CloudUpload,
  "fa-cloud-upload": CloudUpload
};

/**
 * Resuelve un nombre de ícono o clase de FontAwesome al componente Lucide correspondiente.
 */
const resolveIconComponent = (name) => {
  if (!name || typeof name !== "string") return null;

  const cleanName = name.trim().toLowerCase();

  // 1. Coincidencia directa
  if (ICON_MAP[cleanName]) {
    return ICON_MAP[cleanName];
  }

  // 2. Extracción de clase individual fa-*
  const tokens = cleanName.split(/\s+/);
  for (const token of tokens) {
    if (ICON_MAP[token]) {
      return ICON_MAP[token];
    }
    // Si tiene prefijo fa-
    if (token.startsWith("fa-")) {
      const stripped = token.replace(/^fa-/, "");
      if (ICON_MAP[stripped]) {
        return ICON_MAP[stripped];
      }
    }
  }

  return null;
};

/**
 * Adaptador universal de íconos para OpenSign.
 * Soporta nombres semánticos de Lucide y mapeos legacy de FontAwesome.
 */
const Icon = ({
  name,
  size = 18,
  className = "",
  strokeWidth = 2,
  color,
  "aria-hidden": ariaHidden = true,
  ...props
}) => {
  if (!name) return null;

  // Si ya es un componente o elemento React válido
  if (React.isValidElement(name)) {
    return name;
  }

  const Component = resolveIconComponent(name);

  if (Component) {
    return (
      <Component
        size={size}
        className={className}
        strokeWidth={strokeWidth}
        color={color}
        aria-hidden={ariaHidden}
        {...props}
      />
    );
  }

  // Fallback para íconos FontAwesome no migrados aún
  return (
    <i
      className={`${name} ${className}`}
      style={{ fontSize: typeof size === "number" ? `${size}px` : size }}
      aria-hidden="true"
      {...props}
    />
  );
};

export default Icon;
export { ICON_MAP, resolveIconComponent };

