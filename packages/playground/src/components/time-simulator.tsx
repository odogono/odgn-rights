import { useAtom } from 'jotai';

import { simulatedTimeAtom } from '../store/atoms';

const pad = (n: number) => n.toString().padStart(2, '0');

const formatTime = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const TimeSimulator = () => {
  const [time, setTime] = useAtom(simulatedTimeAtom);
  const isLive = time === null;

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
        border: '1px solid #ccc',
        borderRadius: '4px',
        marginTop: '1rem',
        padding: '0.5rem'
      }}
    >
      <label
        style={{
          alignItems: 'center',
          cursor: 'pointer',
          display: 'flex',
          gap: '8px'
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
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '8px'
          }}
        >
          <label className="sr-only" htmlFor="simulated-time">
            Select simulated time:
          </label>
          <input
            id="simulated-time"
            onChange={handleTimeChange}
            style={{ padding: '4px', width: '100%' }}
            type="datetime-local"
            value={formatTime(time!)}
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
