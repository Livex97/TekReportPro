import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, X, Calendar as CalendarIcon, Clock, User, Trash2, Save, Cloud, AlertCircle } from 'lucide-react';
import { getCalendarEvents, setCalendarEvents, getTechnicians, getGoogleSettings, type CalendarEvent, type GoogleCalendarSettings } from './utils/storage';
import { ask } from '@tauri-apps/plugin-dialog';

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    const day = today.getDay(); // 0 is Sunday, 1 is Monday...
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    return new Date(today.setDate(diff));
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [technicians, setTechniciansList] = useState<string[]>([]);
  const [googleSettings, setGoogleSettingsState] = useState<GoogleCalendarSettings | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  
  // Form State
  const [formActivity, setFormActivity] = useState('');
  const [formTech, setFormTech] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const savedEvents = await getCalendarEvents();
    setEvents(savedEvents);
    
    const techs = await getTechnicians();
    setTechniciansList(techs);
    
    const gSettings = await getGoogleSettings();
    setGoogleSettingsState(gSettings);
  };

  const nextWeek = () => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + 7);
    setCurrentDate(next);
  };

  const prevWeek = () => {
    const prev = new Date(currentDate);
    prev.setDate(prev.getDate() - 7);
    setCurrentDate(prev);
  };

  const handleDayClick = (dateStr: string) => {
    setSelectedDay(dateStr);
    setEditingEvent(null);
    setFormActivity('');
    setFormTech(technicians[0] || '');
    setFormNotes('');
    setFormStartTime('');
    setFormEndTime('');
    setIsModalOpen(true);
  };

  const handleEditEvent = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setSelectedDay(event.date);
    setFormActivity(event.activity);
    setFormTech(event.technician);
    setFormNotes(event.notes || '');
    setFormStartTime(event.startTime || '');
    setFormEndTime(event.endTime || '');
    setIsModalOpen(true);
  };

  const handleSaveEvent = async () => {
    if (!formActivity.trim()) return;

    let updatedEvents: CalendarEvent[];
    if (editingEvent) {
      updatedEvents = events.map(e => e.id === editingEvent.id ? {
        ...e,
        activity: formActivity,
        technician: formTech,
        notes: formNotes,
        startTime: formStartTime || undefined,
        endTime: formEndTime || undefined
      } : e);
    } else {
      const newEvent: CalendarEvent = {
        id: crypto.randomUUID(),
        date: selectedDay!,
        activity: formActivity,
        technician: formTech,
        notes: formNotes,
        startTime: formStartTime || undefined,
        endTime: formEndTime || undefined
      };
      updatedEvents = [...events, newEvent];
    }

    setEvents(updatedEvents);
    await setCalendarEvents(updatedEvents);
    setIsModalOpen(false);
    
    // Trigger Sync if enabled
    if (googleSettings?.enabled && googleSettings.clientId && googleSettings.clientSecret) {
        // Sync manager handles this in background effectively
    }
  };

  const handleDeleteEvent = async (id: string) => {
    const confirmed = await ask("Vuoi davvero eliminare questa attività?", { title: 'Elimina Attività', kind: 'warning' });
    if (confirmed) {
      const updatedEvents = events.filter(e => e.id !== id);
      setEvents(updatedEvents);
      await setCalendarEvents(updatedEvents);
      setIsModalOpen(false);
    }
  };

  const renderWeekDays = () => {
    const days = [];
    const weekStart = new Date(currentDate);

    for (let i = 0; i < 5; i++) { // Only 5 days (Mon-Fri)
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + i);
      const dateStr = dayDate.toISOString().split('T')[0];
      const dayEvents = events.filter(e => e.date === dateStr);
      const isToday = new Date().toDateString() === dayDate.toDateString();

      days.push(
        <div
          key={dateStr}
          onClick={() => handleDayClick(dateStr)}
          className={`min-h-[400px] border border-neutral-100 dark:border-neutral-800 p-4 transition-all hover:bg-primary-50/10 dark:hover:bg-primary-900/5 cursor-pointer group flex flex-col items-start
            ${isToday ? 'bg-primary-50/10 dark:bg-primary-900/5' : 'bg-white dark:bg-neutral-800'}
          `}
        >
          <div className="w-full flex items-center justify-between mb-4 pb-2 border-b border-neutral-50 dark:border-neutral-700/50">
            <div>
               <p className="text-[10px] font-black text-neutral-400 uppercase tracking-tighter">
                 {new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(dayDate)}
               </p>
               <span className={`text-xl font-black transition-colors ${isToday ? 'text-primary-600' : 'text-neutral-900 dark:text-neutral-100 group-hover:text-primary-600'}`}>
                 {dayDate.getDate()}
               </span>
            </div>
            {isToday && (
              <div className="bg-primary-600 text-white text-[9px] px-2 py-1 rounded-full font-black uppercase shadow-lg shadow-primary-600/30">
                Oggi
              </div>
            )}
          </div>
          
          <div className="flex-1 w-full space-y-3 overflow-y-auto no-scrollbar">
            {dayEvents.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center opacity-20 group-hover:opacity-40 transition-opacity">
                 <Plus className="w-6 h-6 text-neutral-400" />
                 <span className="text-[9px] font-black uppercase mt-1">Aggiungi</span>
               </div>
            ) : (
              dayEvents.sort((a,b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00')).map(e => (
                <div
                  key={e.id}
                  onClick={(ev) => handleEditEvent(ev, e)}
                  className="group/card relative p-3 rounded-2xl bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md hover:border-primary-400 dark:hover:border-primary-500/50 transition-all active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-black text-primary-600 dark:text-primary-400 uppercase tracking-tighter truncate max-w-[80px]">
                      {e.technician}
                    </span>
                    {e.startTime && (
                      <span className="text-[9px] font-black text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {e.startTime} {e.endTime ? `- ${e.endTime}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-neutral-800 dark:text-neutral-100 leading-tight">
                    {e.activity}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  const getWeekRangeTitle = () => {
    const end = new Date(currentDate);
    end.setDate(currentDate.getDate() + 4);
    
    if (currentDate.getMonth() === end.getMonth()) {
       return `${new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(currentDate)} ${currentDate.getFullYear()}`;
    }
    return `${new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(currentDate)} - ${new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(end)} ${end.getFullYear()}`;
  };

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header of Calendar View */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8 bg-white dark:bg-neutral-800 p-6 rounded-3xl shadow-sm border border-neutral-200 dark:border-neutral-700">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center border border-primary-100 dark:border-primary-800 shadow-sm shrink-0">
            <CalendarIcon className="w-7 h-7 text-primary-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-neutral-900 dark:text-white capitalize">{getWeekRangeTitle()}</h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-sm font-medium flex items-center gap-2">
              <CalendarIcon className="w-3.5 h-3.5" />
              Vista Settimanale Lavorativa (Lun-Ven)
              {googleSettings?.enabled && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold ml-2">
                  <Cloud className="w-3.5 h-3.5" />
                  Sincronizzato
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-neutral-100 dark:bg-neutral-900 p-1.5 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-inner">
          <button
            onClick={prevWeek}
            className="p-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-xl text-neutral-600 dark:text-neutral-300 transition-all hover:shadow-md active:scale-95"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
                const today = new Date();
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                setCurrentDate(new Date(today.setDate(diff)));
            }}
            className="px-5 py-2.5 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-white text-sm font-black rounded-xl hover:shadow-md transition-all active:scale-95 border border-neutral-100 dark:border-neutral-700"
          >
            Oggi
          </button>
          <button
            onClick={nextWeek}
            className="p-2.5 hover:bg-white dark:hover:bg-neutral-800 rounded-xl text-neutral-600 dark:text-neutral-300 transition-all hover:shadow-md active:scale-95"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Calendar Week Grid */}
      <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x border-neutral-100 dark:border-neutral-700">
          {renderWeekDays()}
        </div>
      </div>

      {/* Stats / Legend Section */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-neutral-800 p-6 rounded-3xl border border-neutral-200 dark:border-neutral-700 shadow-sm flex items-start gap-4">
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center border border-emerald-100 dark:border-emerald-800 text-emerald-600">
                <AlertCircle className="w-5 h-5" />
            </div>
            <div>
                <h4 className="text-sm font-black text-neutral-800 dark:text-neutral-200 mb-1">Guida Vista Settimanale</h4>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed font-medium">
                    In questa vista ora puoi leggere l'intera attività pianificata. Clicca sul tasto "+" opaco in una giornata vuota o su un giorno per aggiungere un appuntamento.
                </p>
            </div>
          </div>
      </div>

      {/* Modal for Event Creation/Edit */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-lg bg-white dark:bg-neutral-800 rounded-[2.5rem] shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 sm:p-10">
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center text-primary-600">
                    <CalendarIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-neutral-900 dark:text-white">
                      {editingEvent ? 'Modifica Attività' : 'Nuovo Lavoro'}
                    </h3>
                    <p className="text-sm font-bold text-neutral-400 capitalize">
                      {selectedDay ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(new Date(selectedDay)) : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-2xl transition-colors text-neutral-400"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="relative group">
                  <label className="block text-xs font-black text-neutral-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" />
                    Attività Programmata
                  </label>
                  <textarea
                    autoFocus
                    value={formActivity}
                    onChange={(e) => setFormActivity(e.target.value)}
                    placeholder="Descrizione del lavoro da svolgere..."
                    className="w-full px-6 py-5 bg-neutral-50 dark:bg-neutral-900/50 border-2 border-neutral-100 dark:border-neutral-700 rounded-3xl outline-none focus:border-primary-500 dark:focus:border-primary-500 text-neutral-800 dark:text-white font-bold text-lg placeholder:text-neutral-300 dark:placeholder:text-neutral-600 resize-none h-32 transition-all shadow-inner"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Ora Inizio</label>
                    <input
                      type="time"
                      value={formStartTime}
                      onChange={(e) => setFormStartTime(e.target.value)}
                      className="w-full px-5 py-3.5 bg-neutral-50 dark:bg-neutral-900/50 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 text-neutral-800 dark:text-white font-black"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Ora Fine (Ops)</label>
                    <input
                      type="time"
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="w-full px-5 py-3.5 bg-neutral-50 dark:bg-neutral-900/50 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 text-neutral-800 dark:text-white font-black"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-xs font-black text-neutral-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <User className="w-3.5 h-3.5" />
                      Tecnico Assegnato
                    </label>
                    <select
                      value={formTech}
                      onChange={(e) => setFormTech(e.target.value)}
                      className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-900/50 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 dark:focus:border-primary-500 text-neutral-900 dark:text-white font-bold transition-all shadow-inner appearance-none cursor-pointer"
                    >
                      <option value="" disabled>Seleziona un tecnico...</option>
                      {technicians.map(t => <option key={t} value={t}>{t}</option>)}
                      {technicians.length === 0 && <option disabled>Nessun tecnico configurato</option>}
                    </select>
                  </div>
                </div>

                <div>
                    <label className="block text-xs font-black text-neutral-400 uppercase tracking-widest mb-3">Note Aggiuntive</label>
                    <input
                        type="text"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="Note opzionali..."
                        className="w-full px-6 py-4 bg-neutral-50 dark:bg-neutral-900/50 border-2 border-neutral-100 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 dark:focus:border-primary-500 text-neutral-800 dark:text-white font-semibold transition-all shadow-inner"
                    />
                </div>
              </div>

              <div className="mt-8 flex gap-4">
                {editingEvent && (
                  <button
                    onClick={() => handleDeleteEvent(editingEvent.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-black rounded-3xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-all active:scale-95"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={handleSaveEvent}
                  className="flex-[3] flex items-center justify-center gap-2 py-5 bg-primary-600 text-white font-black rounded-3xl hover:bg-primary-700 transition-all shadow-xl shadow-primary-500/30 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                  disabled={!formActivity.trim()}
                >
                  <Save className="w-5 h-5" />
                  {editingEvent ? 'Salva Modifiche' : 'Salva Appuntamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
