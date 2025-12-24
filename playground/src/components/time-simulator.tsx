import { useAtom } from 'jotai';

import { simulatedTimeAtom } from '../store/atoms';

export const TimeSimulator = () => {
  const [time, setTime] = useAtom(simulatedTimeAtom);
  const isLive = time === null;

  const formatTime = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setTime(new Date(e.target.value));
    }
  };

  const adjustDays = (days: number) => {
    if (time) {
      const next = new Date(time.getTime());
      next.setDate(next.getDate() + days);
      setTime(next);
    }
  };

  return (
    <div
      className="time-simulator"
      style={{
        marginTop: '1rem',
        padding: '0.5rem',
        border: '1px solid #ccc',
        borderRadius: '4px'
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer'
        }}
      >
        <input
          checked={!isLive}
          onChange={e => setTime(e.target.checked ? new Date() : null)}
          type="checkbox"
        />
        <strong>Simulate Time</strong>
      </label>

      {!isLive && (
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <input
            onChange={handleTimeChange}
            type="datetime-local"
            value={formatTime(time!)}
            style={{ padding: '4px', width: '100%' }}
          />

          <div
            className="time-controls"
            style={{ display: 'flex', gap: '4px' }}
          >
            <button onClick={() => adjustDays(-1)} style={{ flex: 1 }}>
              -1 Day
            </button>
            <button onClick={() => setTime(new Date())} style={{ flex: 1 }}>
              Now
            </button>
            <button onClick={() => adjustDays(1)} style={{ flex: 1 }}>
              +1 Day
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
