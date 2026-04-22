import { useAtom } from 'jotai';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatetimeInput } from '@/components/ui/datetime-input';
import { Label } from '@/components/ui/label';
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
      className="time-simulator rounded border border-white/10 mt-4 p-3 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={!isLive}
          id="simulate-time"
          onCheckedChange={checked => setTime(checked ? new Date() : null)}
        />
        <Label className="cursor-pointer font-semibold" htmlFor="simulate-time">
          Simulate Time
        </Label>
      </div>

      {!isLive && (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="simulated-time">
            Select simulated time:
          </label>
          <DatetimeInput
            id="simulated-time"
            onChange={handleTimeChange}
            value={formatTime(time!)}
          />

          <div className="flex gap-1.5">
            <Button className="flex-1" onClick={() => adjustDays(-1)} size="xs" variant="outline">
              -1 Day
            </Button>
            <Button className="flex-1" onClick={() => setTime(new Date())} size="xs" variant="outline">
              Now
            </Button>
            <Button className="flex-1" onClick={() => adjustDays(1)} size="xs" variant="outline">
              +1 Day
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
