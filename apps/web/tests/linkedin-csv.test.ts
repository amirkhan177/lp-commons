import { describe, expect, it } from "vitest";
import { parseConnectedOn, parseCsv, parseLinkedInConnections, personKey } from "@/lib/linkedin-csv";

const EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ana,Silva,https://www.linkedin.com/in/ana-silva-0000,,"Seed Ventures, LLC",General Partner,15 Mar 2023
José,O'Neil,https://www.linkedin.com/in/jose-oneil-0000,jose@example.com,Example Ventures,"Partner, Investments",02 Jan 2019
,,,,,,
`;

describe("LinkedIn Connections.csv", () => {
  it("skips the notes preamble and parses rows", () => {
    const rows = parseLinkedInConnections(EXPORT);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      firstName: "Ana", lastName: "Silva", url: "https://www.linkedin.com/in/ana-silva-0000", email: null,
      company: "Seed Ventures, LLC", position: "General Partner", connectedOn: "2023-03-15",
    });
    expect(rows[1].position).toBe("Partner, Investments");
  });

  it("rejects files without the header", () => {
    expect(() => parseLinkedInConnections("a,b\n1,2\n")).toThrow(/First Name/);
  });

  it("handles quotes, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b ""q"", c"\r\nd,e')).toEqual([["a", 'b "q", c'], ["d", "e"]]);
  });

  it("parses LinkedIn dates", () => {
    expect(parseConnectedOn("5 Sep 2024")).toBe("2024-09-05");
    expect(parseConnectedOn("2024-09-05")).toBe("2024-09-05");
    expect(parseConnectedOn("yesterday")).toBeNull();
  });

  it("normalizes names like the Python pipeline", () => {
    expect(personKey("José", "O'Neil")).toBe("jose o neil");
  });
});
