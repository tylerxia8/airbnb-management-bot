import { notFound } from "next/navigation";
import { Playground } from "../../components/Playground";
import "./playground.css";

export const dynamic = "force-dynamic";
export const metadata = {title: "Lucena Systems Playground", robots: {index: false, follow: false}};

export default function Page() {
  if (process.env.PLAYGROUND_ONLY !== "1") notFound();
  return <Playground />;
}
