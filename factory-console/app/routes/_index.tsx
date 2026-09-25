import { redirect } from "react-router";

export function loader() {
  return redirect("/factory");
}

export default function FactoryHomeRedirect() {
  return null;
}
