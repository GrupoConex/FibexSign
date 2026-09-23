import { useSelector } from "react-redux";
import MailTemplateEditor from "../MailTemplateEditor";

const EmailTab = () => {
  const { tenantInfo } = useSelector((state) => state.user);
  return (
    <div className="op-card bg-base-100 p-4 md:p-5">
      <MailTemplateEditor info={tenantInfo} tenantId={tenantInfo?.objectId} />
    </div>
  );
};

export default EmailTab;
