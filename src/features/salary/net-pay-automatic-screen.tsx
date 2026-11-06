import { SalaryScreen } from "./salary-screen";

export function NetPayAutomaticScreen({ month }: { readonly month: string }) {
  return <SalaryScreen view="net" initialMonth={month} />;
}
