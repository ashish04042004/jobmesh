import { useState } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import StatCards from '../components/StatCards';
import SystemPanel from '../components/SystemPanel';
import SubmitJobForm from '../components/SubmitJobForm';
import JobTable from '../components/JobTable';

export default function DashboardPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: stats, refresh: refreshStats } = usePolling(() => api.stats(), 3000);

  const handleSubmitted = () => {
    setRefreshKey((k) => k + 1);
    refreshStats();
  };

  return (
    <div className="dashboard">
      <StatCards stats={stats} />
      <div className="dashboard-grid">
        <SubmitJobForm onSubmitted={handleSubmitted} />
        <SystemPanel queue={stats?.queue} workers={stats?.workers} />
      </div>
      <JobTable refreshKey={refreshKey} />
    </div>
  );
}
