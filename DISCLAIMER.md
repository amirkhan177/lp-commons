# Disclaimer

**Read this before using LP Commons, its code, its data, or any hosted instance of it.**
By using any of them you accept these terms. If you don't accept them, don't use the project.

## 1. Not advice, not an offer

LP Commons is a software tool and a compilation of public information. It is **not**
investment, financial, legal, tax, accounting, or regulatory advice, and nothing in it is a
recommendation to invest in, or raise money for, any fund, company, or security.

The maintainers and contributors are **not** a broker-dealer, investment adviser, placement
agent, finder, funding portal, or fiduciary to anyone, and receive no compensation tied to any
capital raise or investment. Nothing in this project is an offer to sell, or a solicitation of an
offer to buy, any security.

Talk to qualified legal, compliance, tax, and financial professionals before acting on anything
you find here.

## 2. You are responsible for securities-law compliance

If you use this project to find, contact, or pitch investors, **you alone** are responsible for
complying with every law and rule that applies to you, including, without limitation:

- Regulation D (Rules 504, 506(b), 506(c)), including the prohibition on general solicitation
  in 506(b) offerings and accredited-investor verification in 506(c) offerings;
- the Investment Company Act of 1940 (e.g. 3(c)(1) / 3(c)(7) investor limits) and the
  Investment Advisers Act of 1940;
- state "blue sky" laws, FINRA rules, and the rules on paying unregistered finders or
  placement agents;
- marketing, performance-advertising, anti-fraud, and recordkeeping rules;
- equivalent laws outside the United States.

Inclusion of a person or organization in this project does **not** mean they are an accredited
investor, qualified purchaser, or appropriate or willing investor, or that contacting them is
lawful or welcome.

## 3. Data: public, imperfect, unverified

Data comes from public sources such as SEC EDGAR filings (Form D and others). It is provided
for informational purposes only and:

- is **self-reported** by filers, may be incomplete, outdated, amended, or wrong, and is not
  audited or verified by the SEC or by us;
- passes through **automated parsing, classification, and name-matching** (for example: what
  counts as a "venture capital fund", "fund of funds", "family office", "CVC", or an "active"
  fund; which filings belong to the same person). These heuristics **will** make mistakes,
  including attributing roles to the wrong person with a similar name;
- may lag the original source or miss filings entirely.

Always check the original filing (every record links to it) before relying on any fact.
Do not use this data for credit, employment, insurance, housing, or any other eligibility
decision about an individual. It is **not** a consumer report under the U.S. Fair Credit
Reporting Act or any similar law.

## 4. No affiliation; trademarks

LP Commons is an independent open-source project. It is **not affiliated with, endorsed by,
or sponsored by** the U.S. Securities and Exchange Commission or EDGAR; LinkedIn; Clay;
Anthropic; Railway; GitHub; or any fund, investor, or company that appears in the data. All
names and marks belong to their respective owners and are used only to identify them.

The SEC does not endorse this project or vouch for the accuracy of data derived from EDGAR.

## 5. Third-party services and your own accounts

Some features connect to services under **your own** accounts and keys — for example a
LinkedIn data export, Clay, the Anthropic (Claude) API, SEC EDGAR, Railway, or a database
host. You are responsible for complying with those services' terms, rate limits, and policies,
for any fees or usage charges they bill you, and for keeping your keys secure. In particular:

- **SEC EDGAR:** you must send your own identifying `User-Agent` and stay within the SEC's
  fair-access limits (currently 10 requests per second). The code enforces that cap, but you
  operate the scraper and are responsible for its traffic.
- **LinkedIn:** the project only reads the connections export you download yourself. Do not use
  it, or modify it, to scrape LinkedIn.
- **AI output** (e.g. Claude-generated matches, scores, or draft messages) can be wrong.
  Review it before relying on or sending it.

## 6. Personal data

The dataset contains names and roles of people as they appear in public filings, and any
instance you run will also hold your private network data. If you run an instance, **you are
the operator/controller of that data** and are responsible for having a lawful basis to
process it, keeping it secure, and honoring access, correction, and deletion requests under
laws such as the GDPR, UK GDPR, CCPA/CPRA, and others. See [PRIVACY.md](PRIVACY.md).

## 7. No warranty

THE SOFTWARE, DATA, AND DOCUMENTATION ARE PROVIDED **"AS IS" AND "AS AVAILABLE", WITHOUT
WARRANTY OF ANY KIND**, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION ANY
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT,
ACCURACY, COMPLETENESS, AVAILABILITY, OR SECURITY.

## 8. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL THE AUTHORS, MAINTAINERS,
CONTRIBUTORS, OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY —
INCLUDING DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
LOST PROFITS, LOST OR FAILED INVESTMENTS OR FUNDRAISES, LOSS OF DATA, REGULATORY FINES OR
PENALTIES, OR REPUTATIONAL HARM — ARISING OUT OF OR IN CONNECTION WITH THE SOFTWARE, THE DATA,
OR ANY USE OF OR INABILITY TO USE THEM, WHETHER IN CONTRACT, TORT (INCLUDING NEGLIGENCE),
STRICT LIABILITY, OR OTHERWISE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

Some jurisdictions don't allow certain exclusions or limitations; in those, they apply to the
fullest extent the law allows.

## 9. Your responsibility and indemnity

You use the project at your own risk and are solely responsible for how you use it, for any
instance you deploy, and for anything you send to anyone using it. To the extent permitted by
law, you agree to defend, indemnify, and hold harmless the authors, maintainers, and
contributors from any claims, losses, liabilities, and expenses (including reasonable legal
fees) arising from your use of the project, your deployment of it, your violation of any law
or third-party right, or your breach of these terms.

## 10. Changes and governing documents

This disclaimer may be updated at any time by committing a new version to the repository.
It supplements, and does not replace, the [MIT License](LICENSE) (code) and the
[data license](DATA_LICENSE.md); where they conflict on warranty or liability, the more
protective term for the authors applies to the extent permitted by law.

This disclaimer is not itself legal advice.
