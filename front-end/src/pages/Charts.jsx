import VizChart from "../components/VizChart";
import Pm10Chart from "../components/Pm10Chart";

export default function ChartsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Charts</h2>
      <VizChart />
      <Pm10Chart />
    </div>
  );
}
