import { redirect } from "next/navigation";

export default function LotteryCashAdvancesRedirectPage() {
  redirect("/admin/bank-deposits#lottery-cash");
}
