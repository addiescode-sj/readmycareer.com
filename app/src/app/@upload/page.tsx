"use client";

import ResumeUpload from "@/components/ResumeUpload";
import { useSession } from "@/hooks/useSession";

export default function UploadSlot() {
  const { setResumeJson } = useSession();
  return <ResumeUpload onParsed={setResumeJson} />;
}
