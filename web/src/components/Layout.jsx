import { useState, useEffect, useRef } from 'react'
import { LogOut, Filter, X, ChevronDown, Package, Globe } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getPacks, getAllComponents } from '../store'
import Canvas from '../pages/Canvas'

export default function Layout() {
  const { user, logout } = useAuth()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [filterPack, setFilterPack] = useState(null)
  const [filterSite, setFilterSite] = useState(null)
  const [packs, setPacks] = useState([])
  const [sites, setSites] = useState([])
  const dropdownRef = useRef(null)
  const filterRef = useRef(null)

  useEffect(() => {
    if (!user) return
    async function load() {
      const [p, comps] = await Promise.all([
        getPacks(user.uid),
        getAllComponents(user.uid),
      ])
      setPacks(p)

      // Extract unique hostnames
      const hostSet = new Set()
      comps.forEach((c) => {
        try {
          const host = new URL(c.sourceUrl || '').hostname.replace('www.', '')
          if (host) hostSet.add(host)
        } catch { /* */ }
      })
      setSites([...hostSet].sort())
    }
    load()
  }, [user])

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false)
      }
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilter(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasActiveFilter = filterPack || filterSite
  const activePackName = packs.find((p) => p.id === filterPack)?.name

  return (
    <div className="min-h-screen bg-background">
      <Canvas filterPack={filterPack} filterSite={filterSite} />

      {/* Top-left: Logo */}
      <div className="fixed top-6 left-6 z-50">
        <div className="flex items-center gap-2.5 bg-foreground/80 backdrop-blur-md px-4 py-2.5 rounded-xl border border-border shadow-lg shadow-black/20">
          <img src="/logo.svg" alt="" className="w-6 h-6" />
          <span className="text-lg font-bold tracking-tight font-display text-copy">Backpack</span>
        </div>
      </div>

      {/* Top-right: User dropdown */}
      <div className="fixed top-6 right-6 z-50" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer border border-border bg-foreground/80 backdrop-blur-md p-2 pr-3 rounded-xl shadow-lg shadow-black/20"
        >
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              className="w-7 h-7 rounded-lg"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {user?.displayName?.[0] || '?'}
            </div>
          )}
          <ChevronDown
            size={14}
            className={`text-copy-lighter transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-foreground border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-4 py-3 bg-linear-to-b from-background/50 to-transparent flex items-center gap-3">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-8 h-8 rounded-lg shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {user?.displayName?.[0] || '?'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-copy truncate">
                  {user?.displayName || 'User'}
                </p>
                <p className="text-[11px] text-copy-lighter truncate -mt-0.5">
                  {user?.email}
                </p>
              </div>
            </div>
            <div className="px-2 py-1.5 border-t border-border">
              <button
                onClick={() => {
                  logout()
                  setIsDropdownOpen(false)
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-copy-light hover:text-error hover:bg-error/5 flex items-center gap-2.5 transition-colors border-none bg-transparent cursor-pointer"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom-right: Filter */}
      <div className="fixed bottom-6 right-6 z-50" ref={filterRef}>
        <button
          onClick={() => setShowFilter(!showFilter)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer border transition-all shadow-lg shadow-black/20 backdrop-blur-md ${hasActiveFilter
            ? 'bg-primary/90 text-primary-content border-primary/50'
            : 'bg-foreground/80 text-copy-light border-border hover:text-copy'
            }`}
        >
          <Filter size={15} />
          {hasActiveFilter
            ? (activePackName || filterSite || 'Filtered')
            : 'Filter'}
          {hasActiveFilter && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setFilterPack(null)
                setFilterSite(null)
              }}
              className="ml-0.5 p-0.5 rounded-md hover:bg-white/20 cursor-pointer bg-transparent border-none text-primary-content"
            >
              <X size={12} />
            </button>
          )}
        </button>

        {showFilter && (
          <div className="absolute bottom-full right-0 mb-2 w-60 bg-foreground border border-border rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
            {/* Packs */}
            <div className="px-2 pt-3 pb-2">
              <div className="flex items-center gap-1.5 px-2 mb-2">
                <Package size={12} className="text-copy-lighter" />
                <p className="text-[10px] font-semibold text-copy-lighter uppercase tracking-widest">Packs</p>
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setFilterPack(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[12px] cursor-pointer border-none transition-colors ${!filterPack ? 'bg-primary/10 text-primary font-semibold' : 'bg-transparent text-copy-light hover:bg-background hover:text-copy'
                    }`}
                >
                  All Packs
                </button>
                {packs.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => setFilterPack(pack.id === filterPack ? null : pack.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-[12px] cursor-pointer border-none transition-colors truncate ${filterPack === pack.id ? 'bg-primary/10 text-primary font-semibold' : 'bg-transparent text-copy-light hover:bg-background hover:text-copy'
                      }`}
                  >
                    {pack.name}
                  </button>
                ))}
              </div>
            </div>

            {sites.length > 0 && (
              <>
                <div className="border-t border-border mx-2" />
                <div className="px-2 pt-2 pb-3">
                  <div className="flex items-center gap-1.5 px-2 mb-2">
                    <Globe size={12} className="text-copy-lighter" />
                    <p className="text-[10px] font-semibold text-copy-lighter uppercase tracking-widest">Websites</p>
                  </div>
                  <div className="space-y-0.5 max-h-44 overflow-auto">
                    <button
                      onClick={() => setFilterSite(null)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-[12px] cursor-pointer border-none transition-colors ${!filterSite ? 'bg-primary/10 text-primary font-semibold' : 'bg-transparent text-copy-light hover:bg-background hover:text-copy'
                        }`}
                    >
                      All Sites
                    </button>
                    {sites.map((site) => (
                      <button
                        key={site}
                        onClick={() => setFilterSite(site === filterSite ? null : site)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12px] cursor-pointer border-none transition-colors truncate ${filterSite === site ? 'bg-primary/10 text-primary font-semibold' : 'bg-transparent text-copy-light hover:bg-background hover:text-copy'
                          }`}
                      >
                        {site}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
