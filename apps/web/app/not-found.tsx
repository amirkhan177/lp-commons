import Link from "next/link";
import { Empty, ShellFrame } from "./ui/shell";

export default function NotFound() {
  return (
    <ShellFrame>
      <div className="card">
        <Empty icon="search" title="Page not found"
               actions={<><Link className="btn" href="/reach">Go to Reach</Link><Link className="btn secondary" href="/map">Search funds</Link></>}>
          This page doesn&apos;t exist, or the fund isn&apos;t in the Form D data.
        </Empty>
      </div>
    </ShellFrame>
  );
}
