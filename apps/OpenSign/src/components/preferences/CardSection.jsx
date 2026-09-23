const CardSection = ({ icon: Icon, title, children }) => (
  <div className="op-card bg-base-100 p-4 md:p-5 flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon size={18} aria-hidden="true" />
      </div>
      <h2 className="text-sm font-semibold text-base-content">{title}</h2>
    </div>
    <div className="space-y-5">{children}</div>
  </div>
);

export default CardSection;
