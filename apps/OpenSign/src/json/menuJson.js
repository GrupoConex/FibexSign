const userssetting = [
  {
    icon: "users",
    title: "Users",
    target: "_self",
    pageType: "",
    description: "",
    objectId: "users"
  }
];
export const subSetting = [
  {
    icon: "sliders",
    title: "Preferences",
    target: "_self",
    pageType: "",
    description: "",
    objectId: "preferences"
  },
  ...userssetting
];

const sidebarList = [
  {
    icon: "dashboard",
    title: "Dashboard",
    target: "",
    pageType: "dashboard",
    description: "",
    objectId: "35KBoSgoAK"
  },
  {
    icon: "pen-tool",
    title: "Firma",
    target: "_self",
    pageType: null,
    description: null,
    objectId: null,
    children: [
      {
        icon: "pen-tool",
        title: "Sign yourself",
        target: "_self",
        pageType: "form",
        description: "",
        objectId: "sHAnZphf69"
      },
      {
        icon: "send",
        title: "Request signatures",
        target: "_self",
        pageType: "form",
        description: "",
        objectId: "8mZzFxbG1z"
      }
    ]
  },
  {
    icon: "file-text",
    title: "Templates",
    target: "_self",
    pageType: null,
    description: null,
    objectId: null,
    children: [
      {
        icon: "file-signature",
        title: "Create template",
        target: "_self",
        pageType: "form",
        description: "",
        objectId: "template"
      },
      {
        icon: "file-check",
        title: "Manage templates",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "6TeaPr321t"
      }
    ]
  },
  {
    icon: "folder",
    title: "OpenSign™ Drive",
    target: "_self",
    pageType: "",
    description: "",
    objectId: "drive"
  },
  {
    icon: "folder-archive",
    title: "Documents",
    target: "_self",
    pageType: null,
    description: "",
    objectId: null,
    children: [
      {
        icon: "need-sign",
        title: "Need your sign",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "4Hhwbp482K"
      },
      {
        icon: "in-progress",
        title: "In Progress",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "1MwEuxLEkF"
      },
      {
        icon: "completed",
        title: "Completed",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "kQUoW4hUXz"
      },
      {
        icon: "drafts",
        title: "Drafts",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "ByHuevtCFY"
      },
      {
        icon: "declined",
        title: "Declined",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "UPr2Fm5WY3"
      },
      {
        icon: "expired",
        title: "Expired",
        target: "_self",
        pageType: "report",
        description: "",
        objectId: "zNqBHXHsYH"
      }
    ]
  },
  {
    icon: "contact",
    title: "Contactbook",
    target: "_self",
    pageType: "report",
    description: "",
    objectId: "contacts"
  },
  {
    icon: "settings",
    title: "Settings",
    target: "_self",
    pageType: null,
    description: "",
    objectId: null,
    children: [
      {
        icon: "my-signature",
        title: "My Signature",
        target: "_self",
        pageType: "",
        description: "",
        objectId: "managesign"
      },
      {
        icon: "api-token",
        title: "API Token",
        target: "_self",
        pageType: "",
        description: "",
        objectId: "generatetoken"
      },
      {
        icon: "globe",
        title: "Webhook",
        target: "_self",
        pageType: "",
        description: "",
        objectId: "webhook"
      }
    ]
  }
];
export default sidebarList;
