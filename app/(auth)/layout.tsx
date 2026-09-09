const AuthLayout = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <div className="bg-paper grid min-h-screen grid-cols-[1fr_1fr]">{children}</div>
);

export default AuthLayout;
