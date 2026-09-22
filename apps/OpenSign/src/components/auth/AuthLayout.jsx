import ThemeToggle from "../ThemeToggle";
import logoNegativo from "../../assets/images/Fibex-logo-negativo.svg";
import logoPositivo from "../../assets/images/Fibex-logo-positivo.svg";

const AuthLayout = ({ children }) => {
  return (
    <div className="min-h-screen flex relative">
      <div className="w-full lg:w-1/2 relative flex flex-col items-center justify-center bg-base-200/50 dark:bg-base-100 px-4 sm:px-6 py-10 overflow-y-auto min-h-screen">
        {/* Selector de modo claro / oscuro */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
          <ThemeToggle variant="button" />
        </div>
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-6 text-center select-none">
            <img
              src={logoPositivo}
              alt="FibexSign"
              className="h-10 object-contain dark:hidden"
            />
            <img
              src={logoNegativo}
              alt="FibexSign"
              className="h-10 object-contain hidden dark:block"
            />
            <p className="mt-2 text-xl font-bold tracking-tight text-base-content">
              Fibex<span className="fibex-sign-text">Sign</span>
            </p>
          </div>

          <div className="op-card bg-base-100 border border-slate-200 dark:border-[#243046] p-6 sm:p-8 rounded-box">
            {children}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="hidden lg:block lg:w-1/2 relative border-l border-slate-200/80 dark:border-slate-800/80 select-none fibex-auth-split-bg"
      />
    </div>
  );
};

export default AuthLayout;
