const ROLE_BADGE_CLASS = {
  Admin: "op-badge op-badge-primary",
  OrgAdmin: "op-badge op-badge-neutral",
  Editor: "op-badge op-badge-secondary",
  User: "op-badge op-badge-ghost"
};

const RoleBadge = ({ role }) => {
  const badgeClass = ROLE_BADGE_CLASS[role] || "op-badge op-badge-ghost";
  return (
    <span className={`${badgeClass} font-medium whitespace-nowrap`}>
      {role || "-"}
    </span>
  );
};

export default RoleBadge;
