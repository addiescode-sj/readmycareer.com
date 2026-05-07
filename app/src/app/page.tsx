import { Suspense } from "react";
import RootRouter from "@/components/RootRouter";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RootRouter />
    </Suspense>
  );
}
