const AuthLayout = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <div className="bg-paper flex min-h-screen items-center justify-center px-4">{children}</div>
);

export default AuthLayout;
