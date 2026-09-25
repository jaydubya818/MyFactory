import { Navigate } from "react-router";

export function meta() {
  return [{ title: "Factory Console" }];
}

export default function FactoryHomeRoute() {
  return <Navigate to="/factory" replace />;
}
